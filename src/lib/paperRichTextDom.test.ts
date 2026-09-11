import { describe, expect, it } from 'vitest';
import { cssColorToHex, richTextToEditorHtml, runInlineCss } from './paperRichTextDom';

describe('paperRichTextDom pure helpers', () => {
  it('builds editor HTML with a block per paragraph and a styled span per run', () => {
    const html = richTextToEditorHtml([
      { runs: [{ text: 'Hi ' }, { text: 'bold', fontWeight: '700' }] },
      { runs: [{ text: 'Item' }], listMarker: '•' },
    ], 1);
    expect(html).toContain('<div><span>Hi </span><span style="font-weight:700">bold</span></div>');
    expect(html).toContain('data-paper-marker="•"');
    expect(html).toContain('<span>Item</span>');
  });

  it('renders an empty paragraph as a <br> so blank lines survive', () => {
    expect(richTextToEditorHtml([{ runs: [{ text: '' }] }], 1)).toContain('<br>');
  });

  it('runInlineCss emits only the overrides a run carries, incl. super/subscript shrink', () => {
    expect(runInlineCss({ text: 'x' }, 1)).toBe('');
    expect(runInlineCss({ text: 'x', underline: true, strike: true }, 1)).toBe('text-decoration:underline line-through');
    expect(runInlineCss({ text: 'x', vertAlign: 'super' }, 1)).toBe('vertical-align:super;font-size:0.7em');
    expect(runInlineCss({ text: 'x', color: '#ff0000' }, 1)).toBe('color:#ff0000');
  });

  it('parses rgb()/hex colours to #rrggbb', () => {
    expect(cssColorToHex('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(cssColorToHex('#00FF00')).toBe('#00ff00');
    expect(cssColorToHex('rgba(0, 0, 255, 0.5)')).toBe('#0000ff');
    expect(cssColorToHex('not-a-color')).toBeUndefined();
  });

  it('escapes HTML in run text so markup in a document cannot break the editor', () => {
    expect(richTextToEditorHtml([{ runs: [{ text: '<b>&"x"' }] }], 1)).toContain('&lt;b&gt;&amp;&quot;x&quot;');
  });

  it('shows inherited rich-paragraph separation without persisting authored spacing', () => {
    const html = richTextToEditorHtml([
      { runs: [{ text: 'First' }] },
      { runs: [{ text: 'Second' }] },
    ], 1, {
      typography: {
        fontFamily: 'Fixture Sans', fontSizePt: 12, leadingPt: 20, tracking: 0,
        align: 'left', hyphenate: false, color: '#111111', fontWeight: '400', fontStyle: 'normal',
        firstLineIndentMm: 0, smallCaps: false, numericStyle: 'normal', dropCapLines: 0,
        writingMode: 'horizontal-tb',
      },
      managedFonts: [],
    });

    expect(html).toContain('margin-bottom:26.66px');
    expect(html).not.toContain('data-sa=');
  });

  it('encodes paragraph shading/borders/indent as CSS + data-* so an edit can round-trip them', () => {
    const html = richTextToEditorHtml([
      {
        runs: [{ text: 'Callout' }],
        align: 'center',
        shading: '#dddddd',
        borders: { right: { color: 'currentColor', widthPt: 0.5 }, paddingPt: 4 },
        leftIndentMm: 12.7,
        hangingIndentMm: 12.7,
        dropCapLines: 3,
      },
    ], 1);
    // Visual CSS the editor shows while typing.
    expect(html).toContain('background-color:#dddddd');
    expect(html).toContain('border-right:0.67px solid currentColor');
    expect(html).toContain('text-indent:-48.00px'); // hanging indent out-dents the first line
    // Machine-readable attributes the serializer reads back (computed style can't carry these).
    expect(html).toContain('data-align="center"');
    expect(html).toContain('data-shade="#dddddd"');
    expect(html).toContain('data-hi="12.7"');
    expect(html).toContain('data-dc="3"');
    expect(html).toContain('data-borders=');
  });

  it('uses each-line text indent in the rich editor paragraph CSS', () => {
    const html = richTextToEditorHtml([
      { runs: [{ text: 'Every line is indented while editing.' }], firstLineIndentMm: 4 },
    ], 1);

    expect(html).toContain('text-indent:15.12px each-line');
  });
});
