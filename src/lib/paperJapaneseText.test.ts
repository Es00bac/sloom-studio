import { describe, expect, it } from 'vitest';

import {
  addFrameToPaperPage,
  createDefaultPaperDocument,
  exportPaperDocumentToPrintHtml,
  updatePaperFrame,
} from './paperDocument';
import {
  canBreakPaperJapaneseBefore,
  paperEmphasisMarkToCss,
  paperInlineTextToHtml,
  paperInlineTextUsesBrowserNativeLayout,
  tokenizePaperInlineText,
  tokenizePaperInlineTextWithOffsets,
} from './paperJapaneseText';
import { frameTextIsVectorSafe } from './paperPdfxVectorTextFrames';
import type { PaperFrame } from '../types/paper';

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('tokenizePaperInlineText', () => {
  it('parses furigana with a kanji auto-base and stops at kana', () => {
    // Auto-base must be 日本語, not 年に日本語 (the kana に ends the base run).
    const tokens = tokenizePaperInlineText('年に日本語《にほんご》', false);
    expect(tokens).toEqual([
      { type: 'text', text: '年に' },
      { type: 'ruby', base: '日本語', reading: 'にほんご' },
    ]);
  });

  it('honours the ｜ delimiter for a non-kanji base', () => {
    const tokens = tokenizePaperInlineText('｜お前《てめえ》', false);
    expect(tokens).toEqual([{ type: 'ruby', base: 'お前', reading: 'てめえ' }]);
  });

  it('auto-sets 1-2 digit runs as tate-chū-yoko only in vertical text', () => {
    expect(tokenizePaperInlineText('第12巻', true)).toEqual([
      { type: 'text', text: '第' },
      { type: 'tcy', digits: '12' },
      { type: 'text', text: '巻' },
    ]);
    // 3+ digits stay plain/rotated (no TCY), and horizontal never gets TCY at all.
    const year = tokenizePaperInlineText('西暦2024年', true);
    expect(year.some((t) => t.type === 'tcy')).toBe(false);
    expect(year.map((t) => (t.type === 'text' ? t.text : '')).join('')).toBe('西暦2024年');
    expect(tokenizePaperInlineText('第12巻', false)).toEqual([{ type: 'text', text: '第12巻' }]);
  });

  it('returns a single text token for plain strings (fast path)', () => {
    expect(tokenizePaperInlineText('ふつうの文章', false)).toEqual([{ type: 'text', text: 'ふつうの文章' }]);
  });

  it('identifies inline annotations that must share browser layout with export', () => {
    expect(paperInlineTextUsesBrowserNativeLayout('日本語《にほんご》', false)).toBe(true);
    expect(paperInlineTextUsesBrowserNativeLayout('《《強調》》', false)).toBe(true);
    expect(paperInlineTextUsesBrowserNativeLayout('第12巻', true)).toBe(true);
    expect(paperInlineTextUsesBrowserNativeLayout('Plain managed text', false)).toBe(false);
  });

  it('parses narou-style 《《…》》 as an emphasis (圏点) token', () => {
    expect(tokenizePaperInlineText('とても《《大事》》な事', false)).toEqual([
      { type: 'text', text: 'とても' },
      { type: 'emphasis', text: '大事' },
      { type: 'text', text: 'な事' },
    ]);
  });

  it('handles emphasis and furigana together (emphasis wins over a 《…》 ruby read)', () => {
    expect(tokenizePaperInlineText('《《絶対》》に漢字《かんじ》', false)).toEqual([
      { type: 'emphasis', text: '絶対' },
      { type: 'text', text: 'に' },
      { type: 'ruby', base: '漢字', reading: 'かんじ' },
    ]);
  });

  it('retains authored source offsets while resolving ruby notation for managed composition', () => {
    expect(tokenizePaperInlineTextWithOffsets('漢字《かんじ》', false)).toEqual([{
      type: 'ruby',
      base: '漢字',
      reading: 'かんじ',
      sourceStart: 0,
      sourceEnd: 7,
      baseSourceStart: 0,
      baseSourceEnd: 2,
    }]);
  });
});

describe('paperInlineTextToHtml', () => {
  it('emits <ruby> and escapes text, dropping the raw 《》 notation', () => {
    const html = paperInlineTextToHtml('魔法《まほう》の力！', false, escapeHtml);
    expect(html).toBe('<ruby>魔法<rt>まほう</rt></ruby>の力！');
    expect(html).not.toContain('《');
  });

  it('wraps tate-chū-yoko digits in a text-combine-upright span (vertical)', () => {
    expect(paperInlineTextToHtml('P12', true, escapeHtml)).toContain('text-combine-upright: all');
  });

  it('escapes HTML-special characters in text and readings', () => {
    expect(paperInlineTextToHtml('a<b>&', false, escapeHtml)).toBe('a&lt;b&gt;&amp;');
  });

  it('emits a text-emphasis span for 《《…》》 (圏点)', () => {
    expect(paperInlineTextToHtml('《《強調》》', false, escapeHtml)).toBe('<span style="text-emphasis: filled sesame">強調</span>');
  });
});

describe('paperEmphasisMarkToCss', () => {
  it('maps bouten choices to CSS text-emphasis values', () => {
    expect(paperEmphasisMarkToCss('sesame')).toBe('filled sesame');
    expect(paperEmphasisMarkToCss('dot')).toBe('filled dot');
    expect(paperEmphasisMarkToCss('none')).toBeUndefined();
    expect(paperEmphasisMarkToCss(undefined)).toBeUndefined();
  });
});

describe('Japanese kinsoku helpers', () => {
  it('does not allow prohibited closing punctuation to begin a strict line', () => {
    expect(canBreakPaperJapaneseBefore('、', true)).toBe(false);
    expect(canBreakPaperJapaneseBefore('」', true)).toBe(false);
    expect(canBreakPaperJapaneseBefore('記', true)).toBe(true);
  });
});

describe('print/PDF export carries Japanese vertical typesetting', () => {
  it('exports a vertical speech bubble with furigana as ruby, centered vertical text', () => {
    let doc = createDefaultPaperDocument({ title: '縦書き Bubble' });
    const pageId = doc.pages[0].id;
    const added = addFrameToPaperPage(doc, pageId, { kind: 'speechBubble', xMm: 20, yMm: 20, widthMm: 60, heightMm: 40 });
    doc = added.document;
    const frame = doc.pages[0].frames.find((f) => f.id === added.frameId)!;
    doc = updatePaperFrame(doc, pageId, added.frameId, {
      text: '魔法《まほう》の力だ！',
      typography: { ...frame.typography, writingMode: 'vertical-rl' },
    });

    const html = exportPaperDocumentToPrintHtml(doc);
    expect(html).toContain('writing-mode: vertical-rl');
    expect(html).toContain('<ruby>魔法<rt>まほう</rt></ruby>');
    expect(html).not.toContain('魔法《まほう》'); // raw notation must be resolved, not exported literally
    expect(html).toContain('align-items:'); // vertical bubble centers columns via align-items, not justify only
  });

  it('exports a vertical text frame with kinsoku + bouten emphasis', () => {
    let doc = createDefaultPaperDocument({ title: '縦書き Text' });
    const pageId = doc.pages[0].id;
    const added = addFrameToPaperPage(doc, pageId, { kind: 'text', xMm: 10, yMm: 10, widthMm: 40, heightMm: 80 });
    doc = added.document;
    const frame = doc.pages[0].frames.find((f) => f.id === added.frameId)!;
    doc = updatePaperFrame(doc, pageId, added.frameId, {
      text: 'これは縦書きの本文です。',
      typography: { ...frame.typography, writingMode: 'vertical-rl', emphasis: 'sesame' },
    });

    const html = exportPaperDocumentToPrintHtml(doc);
    expect(html).toContain('writing-mode: vertical-rl');
    expect(html).toContain('line-break: strict');
    expect(html).toContain('text-emphasis: filled sesame');
  });

  it('exports inline 《《…》》 emphasis (圏点) into the print html', () => {
    let doc = createDefaultPaperDocument({ title: 'Inline emphasis' });
    const pageId = doc.pages[0].id;
    const added = addFrameToPaperPage(doc, pageId, { kind: 'text', xMm: 10, yMm: 10, widthMm: 60, heightMm: 20 });
    doc = updatePaperFrame(added.document, pageId, added.frameId, { text: '普通の《《傍点》》テキスト' });
    const html = exportPaperDocumentToPrintHtml(doc);
    expect(html).toContain('<span style="text-emphasis: filled sesame">傍点</span>');
    expect(html).not.toContain('《《'); // notation resolved, not exported literally
  });

  it('leaves a horizontal frame free of vertical CSS', () => {
    let doc = createDefaultPaperDocument({ title: 'Horizontal' });
    const pageId = doc.pages[0].id;
    const added = addFrameToPaperPage(doc, pageId, { kind: 'text', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20 });
    doc = updatePaperFrame(added.document, pageId, added.frameId, { text: 'Plain English body' });
    const html = exportPaperDocumentToPrintHtml(doc);
    expect(html).not.toContain('writing-mode: vertical-rl');
  });
});

describe('PDF/X vector-text export rasterizes Japanese frames (never draws them wrong)', () => {
  const baseTextFrame = (): PaperFrame => {
    const doc = createDefaultPaperDocument({ title: 'Vector gate' });
    const added = addFrameToPaperPage(doc, doc.pages[0].id, { kind: 'text', xMm: 10, yMm: 10, widthMm: 40, heightMm: 40 });
    return added.document.pages[0].frames.find((f) => f.id === added.frameId)!;
  };

  it('treats a plain horizontal frame as vector-safe (selectable type)', () => {
    const frame = { ...baseTextFrame(), text: 'Plain body copy' };
    expect(frameTextIsVectorSafe(frame)).toBe(true);
  });

  it('forces vertical / furigana / emphasis frames to rasterize (NOT vector)', () => {
    const base = baseTextFrame();
    // Vertical writing can't be laid out by the left-to-right linear engine.
    expect(frameTextIsVectorSafe({ ...base, text: 'たて書き', typography: { ...base.typography, writingMode: 'vertical-rl' } })).toBe(false);
    // Furigana notation would be drawn as literal 《》 glyphs by the outliner.
    expect(frameTextIsVectorSafe({ ...base, text: '漢字《かんじ》' })).toBe(false);
    // 圏点 emphasis marks aren't reproducible by the glyph engine.
    expect(frameTextIsVectorSafe({ ...base, text: '強調', typography: { ...base.typography, emphasis: 'sesame' } })).toBe(false);
  });
});
