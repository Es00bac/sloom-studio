// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createRichEditorBase, richTextToEditorHtml, serializeRichEditor, type RichEditorBase } from './paperRichTextDom';
import type { PaperRichParagraph, PaperTypography } from '../types/paper';

const BASE: RichEditorBase = { colorHex: '#111111', fontFamily: 'Inter', fontSizePx: 16, zoom: 1 };

const SESSION_TYPOGRAPHY: PaperTypography = {
  fontFamily: 'Inter', fontSizePt: 12, leadingPt: 15, tracking: 0, fontKerning: 'auto', align: 'left',
  hyphenate: true, color: '#111111', fontWeight: '400', fontStyle: 'normal', numericStyle: 'normal',
};

/** Seed a contentEditable from paragraphs, then read it back — the exact edit lifecycle. */
function roundTrip(paragraphs: PaperRichParagraph[]): PaperRichParagraph[] {
  const div = document.createElement('div');
  div.innerHTML = richTextToEditorHtml(paragraphs, 1);
  return serializeRichEditor(div, BASE);
}

describe('rich editor paragraph round-trip (edit must not drop paragraph formatting)', () => {
  it.each([
    ['100% → 200%', 1, 2],
    ['200% → 50%', 2, 0.5],
  ])('keeps mixed explicit run size and leading in authored units when zoom changes from %s', (_label, openingZoom, currentZoom) => {
    const source: PaperRichParagraph[] = [{
      leadingPt: 19,
      runs: [
        { text: 'Display', fontSizePt: 24, leadingPt: 30 },
        { text: ' body', fontSizePt: 9, leadingPt: 11 },
      ],
    }];
    const editor = document.createElement('div');

    // This is the production lifecycle boundary: seed once when rich editing opens, then serialize on commit.
    editor.innerHTML = richTextToEditorHtml(source, openingZoom);
    // The current canvas zoom is intentionally different, but the editor's session conversion base remains
    // anchored to the scale at which this uncontrolled DOM was opened.
    void currentZoom;
    const committed = serializeRichEditor(editor, createRichEditorBase(SESSION_TYPOGRAPHY, openingZoom));

    expect(committed[0].leadingPt).toBe(19);
    expect(committed[0].runs[0]).toMatchObject({ text: 'Display' });
    expect(committed[0].runs[0].fontSizePt).toBeCloseTo(24, 2);
    expect(committed[0].runs[0].leadingPt).toBeCloseTo(30, 2);
    expect(committed[0].runs[1]).toMatchObject({ text: ' body' });
    expect(committed[0].runs[1].fontSizePt).toBeCloseTo(9, 2);
    expect(committed[0].runs[1].leadingPt).toBeCloseTo(11, 2);
  });

  it('keeps mixed explicit run size and leading when opening and commit zoom match', () => {
    const source: PaperRichParagraph[] = [{
      leadingPt: 19,
      runs: [
        { text: 'Display', fontSizePt: 24, leadingPt: 30 },
        { text: ' body', fontSizePt: 9, leadingPt: 11 },
      ],
    }];
    const editor = document.createElement('div');
    editor.innerHTML = richTextToEditorHtml(source, 1);

    const committed = serializeRichEditor(editor, createRichEditorBase(SESSION_TYPOGRAPHY, 1));

    expect(committed[0].leadingPt).toBe(19);
    expect(committed[0].runs[0].fontSizePt).toBeCloseTo(24, 2);
    expect(committed[0].runs[0].leadingPt).toBeCloseTo(30, 2);
    expect(committed[0].runs[1].fontSizePt).toBeCloseTo(9, 2);
    expect(committed[0].runs[1].leadingPt).toBeCloseTo(11, 2);
  });

  it('keeps paragraph leading inherited while preserving an explicit lower run override', () => {
    const source: PaperRichParagraph[] = [{
      leadingPt: 22,
      runs: [
        { text: 'Inherited ' },
        { text: 'lower', leadingPt: 11 },
        { text: ' inherited' },
      ],
    }];
    const editor = document.createElement('div');
    editor.innerHTML = richTextToEditorHtml(source, 1);
    const spans = editor.querySelectorAll<HTMLSpanElement>('span');
    // jsdom does not expose inherited line-height through getComputedStyle like a browser does. Mirror the
    // browser's effective value onto the two unstyled spans so this regression exercises extraction rather
    // than passing because of that environment difference. No authored-leading marker is added.
    spans[0].style.lineHeight = `${22 * 1.333}px`;
    spans[2].style.lineHeight = `${22 * 1.333}px`;

    const committed = serializeRichEditor(editor, BASE);

    expect(committed).toEqual(source);
  });

  it('keeps one styled blank paragraph between inherited-leading paragraphs', () => {
    const source: PaperRichParagraph[] = [
      { leadingPt: 22, runs: [{ text: 'Before' }] },
      { leadingPt: 17, runs: [{ text: '' }] },
      { leadingPt: 22, runs: [{ text: 'After' }] },
    ];

    expect(roundTrip(source)).toEqual(source);
  });

  it('preserves advanced character and paragraph typesetting properties', () => {
    const out = roundTrip([{
      alignLast: 'center',
      leadingPt: 18,
      hyphenate: false,
      lineBreak: 'pretty',
      lineBreakStrict: true,
      runs: [{
        text: 'Advanced type',
        fontFamily: 'Georgia',
        fontSizePt: 18,
        leadingPt: 20,
        fontWeight: '500',
        fontStyle: 'italic',
        fontKerning: 'none',
        color: '#123456',
        tracking: 75,
        smallCaps: true,
        numericStyle: 'tabular',
        textOrientation: 'upright',
        emphasis: 'sesame',
      }],
    }]);
    expect(out[0]).toMatchObject({ alignLast: 'center', leadingPt: 18, hyphenate: false, lineBreak: 'pretty', lineBreakStrict: true });
    expect(out[0].runs[0]).toMatchObject({
      text: 'Advanced type', fontFamily: 'Georgia', leadingPt: 20, fontWeight: '500',
      fontStyle: 'italic', fontKerning: 'none', color: '#123456', tracking: 75, smallCaps: true,
      numericStyle: 'tabular', textOrientation: 'upright', emphasis: 'sesame',
    });
    expect(out[0].runs[0].fontSizePt).toBeCloseTo(18, 2);
  });

  it('preserves run hyperlinks instead of flattening anchors during an edit', () => {
    const out = roundTrip([{ runs: [{ text: 'Signaloom', link: 'https://example.com/signaloom', underline: true }] }]);
    expect(out[0].runs[0]).toMatchObject({ text: 'Signaloom', link: 'https://example.com/signaloom', underline: true });
  });

  it('preserves align, spacing, indents, drop cap, shading, and borders across an edit', () => {
    const out = roundTrip([
      {
        runs: [{ text: 'A shaded, bordered, hanging paragraph' }],
        align: 'center',
        spaceBeforeMm: 2,
        spaceAfterMm: 3,
        leftIndentMm: 12.7,
        hangingIndentMm: 12.7,
        dropCapLines: 3,
        shading: '#dddddd',
        borders: { right: { color: '#4472c4', widthPt: 0.5 }, paddingPt: 4 },
      },
    ]);
    expect(out).toHaveLength(1);
    const p = out[0];
    expect(p.align).toBe('center');
    expect(p.spaceBeforeMm).toBeCloseTo(2, 3);
    expect(p.spaceAfterMm).toBeCloseTo(3, 3);
    expect(p.leftIndentMm).toBeCloseTo(12.7, 3);
    expect(p.hangingIndentMm).toBeCloseTo(12.7, 3);
    expect(p.dropCapLines).toBe(3);
    expect(p.shading).toBe('#dddddd');
    expect(p.borders?.right).toMatchObject({ color: '#4472c4', widthPt: 0.5 });
    expect(p.borders?.paddingPt).toBe(4);
    // The text content survives too.
    expect(p.runs.map((run) => run.text).join('')).toBe('A shaded, bordered, hanging paragraph');
  });

  it('keeps a list marker and its paragraph attributes together', () => {
    const out = roundTrip([{ runs: [{ text: 'Bulleted' }], listMarker: '•', align: 'right' }]);
    expect(out[0].listMarker).toBe('•');
    expect(out[0].align).toBe('right');
    expect(out[0].runs.map((run) => run.text).join('')).toBe('Bulleted');
  });

  it('picks up paragraph attributes the toolbar sets on a plain block (align/dropcap/shading authoring)', () => {
    // Mimic what the rich-editor paragraph toolbar does: add data-* to an existing block, then commit.
    const div = document.createElement('div');
    div.innerHTML = richTextToEditorHtml([{ runs: [{ text: 'Authored paragraph' }] }], 1);
    const block = div.querySelector('div');
    if (!block) throw new Error('expected a block');
    block.dataset.align = 'center';
    block.dataset.dc = '3';
    block.dataset.shade = '#ffff00';
    const out = serializeRichEditor(div, BASE);
    expect(out[0].align).toBe('center');
    expect(out[0].dropCapLines).toBe(3);
    expect(out[0].shading).toBe('#ffff00');
    expect(out[0].runs.map((run) => run.text).join('')).toBe('Authored paragraph');
  });

  it('does not invent paragraph formatting for a plain paragraph', () => {
    const out = roundTrip([{ runs: [{ text: 'Just text' }] }]);
    expect(out[0].shading).toBeUndefined();
    expect(out[0].borders).toBeUndefined();
    expect(out[0].align).toBeUndefined();
    expect(out[0].hangingIndentMm).toBeUndefined();
  });
});
