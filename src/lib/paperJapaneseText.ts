// Shared Japanese inline-notation handling used by BOTH the on-canvas React render (PaperWorkspace) and the
// print/PDF HTML export (paperDocument), so what you see on the page is exactly what gets exported.
//
// Notation (the standard Aozora/pixiv/narou conventions the letterer types inline):
//   漢字《かんじ》     furigana (ルビ): base = the trailing run of KANJI; a kana/Latin char ends the run, so
//                     「年に日本語《にほんご》」 attaches the reading to 日本語, not 年に日本語
//   ｜熟語《じゅくご》  the fullwidth ｜ delimiter lets the base be any characters (kana-led words, mixed, …)
//   《《強調》》        emphasis dots (圏点/傍点) on the enclosed word — the narou-style double angle brackets
// In vertical text, 1–2 digit numbers are auto-set as tate-chū-yoko (縦中横) — upright/horizontal so page
// numbers read across the column; longer runs (years like 2024) stay rotated, as novels typeset them.
//
// Inline notation (not per-run model fields) is deliberate: it lives in the frame text, so it survives the
// export's rich-text flattening — furigana AND emphasis come out identical on canvas and in the PDF.

import type { PaperEmphasisMark } from '../types/paper';

export type PaperInlineToken =
  | { type: 'text'; text: string }
  | { type: 'ruby'; base: string; reading: string }
  | { type: 'emphasis'; text: string }
  | { type: 'tcy'; digits: string };

/** A token plus offsets into the unparsed inline source (UTF-16 offsets, matching browser selection APIs). */
export type PaperInlineTokenWithOffsets = PaperInlineToken & {
  sourceStart: number;
  sourceEnd: number;
  /** The visual base range for ruby; the reading occupies the remainder of the token source. */
  baseSourceStart?: number;
  baseSourceEnd?: number;
};

// Alternatives, left-to-right priority:
//   1. 《《word》》            emphasis (must precede ruby so 《《…》》 isn't read as a 《…》 ruby)
//   2. ｜base《reading》      furigana with an explicit ｜ delimiter (base = any non-delimiter chars)
//   3. kanjiRun《reading》    furigana with an auto kanji base
const PAPER_INLINE_RE =
  /《《([^《》\n]+)》》|｜([^｜《》\n]+)《([^《》\n]+)》|([々〇〻㐀-䶿一-鿿豈-﫿〆ヶ]+)《([^《》\n]+)》/g;

function pushPlain(tokens: PaperInlineToken[], text: string, vertical: boolean): void {
  if (!text) return;
  if (!vertical || !/\d/.test(text)) {
    tokens.push({ type: 'text', text });
    return;
  }
  const re = /\d+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) tokens.push({ type: 'text', text: text.slice(last, match.index) });
    if (match[0].length <= 2) tokens.push({ type: 'tcy', digits: match[0] });
    else tokens.push({ type: 'text', text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) });
}

function pushPlainWithOffsets(
  tokens: PaperInlineTokenWithOffsets[],
  text: string,
  sourceStart: number,
  vertical: boolean,
): void {
  if (!text) return;
  if (!vertical || !/\d/.test(text)) {
    tokens.push({ type: 'text', text, sourceStart, sourceEnd: sourceStart + text.length });
    return;
  }
  const re = /\d+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) {
      const plain = text.slice(last, match.index);
      tokens.push({ type: 'text', text: plain, sourceStart: sourceStart + last, sourceEnd: sourceStart + match.index });
    }
    const tokenStart = sourceStart + match.index;
    if (match[0].length <= 2) {
      tokens.push({ type: 'tcy', digits: match[0], sourceStart: tokenStart, sourceEnd: tokenStart + match[0].length });
    } else {
      tokens.push({ type: 'text', text: match[0], sourceStart: tokenStart, sourceEnd: tokenStart + match[0].length });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    tokens.push({ type: 'text', text: text.slice(last), sourceStart: sourceStart + last, sourceEnd: sourceStart + text.length });
  }
}

/** Parse the inline notation into a flat token list (furigana, emphasis, tate-chū-yoko, plain runs). */
export function tokenizePaperInlineText(text: string, vertical: boolean): PaperInlineToken[] {
  const tokens: PaperInlineToken[] = [];
  if (!text) return tokens;
  if (!text.includes('《')) {
    pushPlain(tokens, text, vertical);
    return tokens;
  }
  let last = 0;
  let match: RegExpExecArray | null;
  PAPER_INLINE_RE.lastIndex = 0;
  while ((match = PAPER_INLINE_RE.exec(text))) {
    if (match.index > last) pushPlain(tokens, text.slice(last, match.index), vertical);
    if (match[1] != null) {
      tokens.push({ type: 'emphasis', text: match[1] });
    } else {
      tokens.push({ type: 'ruby', base: match[2] ?? match[4] ?? '', reading: match[3] ?? match[5] ?? '' });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) pushPlain(tokens, text.slice(last), vertical);
  return tokens;
}

/**
 * Browser-native inline annotations own geometry that HarfBuzz glyph positioning alone cannot reproduce:
 * ruby distributes a reading across its base and expands the CSS line box, while text-emphasis and TCY also
 * participate in browser line layout. The editor routes these frames through the same authenticated-font DOM
 * layout used by print/raster export so their canvas preview is genuinely WYSIWYG.
 */
export function paperInlineTextUsesBrowserNativeLayout(text: string, vertical: boolean): boolean {
  return tokenizePaperInlineText(text, vertical).some((token) => token.type !== 'text');
}

/**
 * Offset-preserving counterpart to {@link tokenizePaperInlineText}. Composition uses this so ruby/emphasis
 * annotations remain tied to authored source offsets instead of losing caret/export identity during parsing.
 */
export function tokenizePaperInlineTextWithOffsets(text: string, vertical: boolean): PaperInlineTokenWithOffsets[] {
  const tokens: PaperInlineTokenWithOffsets[] = [];
  if (!text) return tokens;
  if (!text.includes('《')) {
    pushPlainWithOffsets(tokens, text, 0, vertical);
    return tokens;
  }
  let last = 0;
  let match: RegExpExecArray | null;
  PAPER_INLINE_RE.lastIndex = 0;
  while ((match = PAPER_INLINE_RE.exec(text))) {
    if (match.index > last) pushPlainWithOffsets(tokens, text.slice(last, match.index), last, vertical);
    const sourceStart = match.index;
    const sourceEnd = match.index + match[0].length;
    if (match[1] != null) {
      tokens.push({
        type: 'emphasis',
        text: match[1],
        sourceStart,
        sourceEnd,
        baseSourceStart: sourceStart + 2,
        baseSourceEnd: sourceStart + 2 + match[1].length,
      });
    } else {
      const explicitBase = match[2];
      const base = explicitBase ?? match[4] ?? '';
      const reading = match[3] ?? match[5] ?? '';
      const baseSourceStart = sourceStart + (explicitBase != null ? 1 : 0);
      tokens.push({
        type: 'ruby',
        base,
        reading,
        sourceStart,
        sourceEnd,
        baseSourceStart,
        baseSourceEnd: baseSourceStart + base.length,
      });
    }
    last = sourceEnd;
  }
  if (last < text.length) pushPlainWithOffsets(tokens, text.slice(last), last, vertical);
  return tokens;
}

// Japanese kinsoku shori. Closing punctuation may not begin a line; opening punctuation may not end one.
// This is intentionally a concise, conservative set covering the Japanese characters Paper exposes today.
const KINSOKU_LINE_START = /^[、。，．・：；？！ー）］｝〉》」』】〕〙〗〟’”ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]/u;
const KINSOKU_LINE_END = /[「『（［｛〈《【〔〘〖‘“]/u;

/** True when a strict Japanese line may begin with `nextText`. */
export function canBreakPaperJapaneseBefore(nextText: string, strict = true): boolean {
  return !strict || !KINSOKU_LINE_START.test(nextText);
}

/** True when a strict Japanese line may end with `previousText`. */
export function canBreakPaperJapaneseAfter(previousText: string, strict = true): boolean {
  return !strict || !KINSOKU_LINE_END.test(previousText);
}

// Inline 圏点 default = filled sesame (ゴマ点), the most common emphasis mark. Frame-level emphasis (typography
// .emphasis) can still set a different mark for the whole frame; an inline 《《…》》 word overrides it locally.
const INLINE_EMPHASIS_CSS = 'text-emphasis: filled sesame';

/** Render the tokens to an HTML string for the print/PDF export. `escapeHtml` escapes the text nodes. */
export function paperInlineTextToHtml(text: string, vertical: boolean, escapeHtml: (value: string) => string): string {
  return tokenizePaperInlineText(text, vertical)
    .map((token) => {
      if (token.type === 'text') return escapeHtml(token.text);
      if (token.type === 'tcy') return `<span style="text-combine-upright: all">${escapeHtml(token.digits)}</span>`;
      if (token.type === 'emphasis') return `<span style="${INLINE_EMPHASIS_CSS}">${escapeHtml(token.text)}</span>`;
      return `<ruby>${escapeHtml(token.base)}<rt>${escapeHtml(token.reading)}</rt></ruby>`;
    })
    .join('');
}

/** True when a frame's typography is set to Japanese vertical writing (縦書き). */
export function isPaperVerticalWritingMode(writingMode: string | undefined): boolean {
  return writingMode === 'vertical-rl';
}

/** Map a 圏点 emphasis choice to a CSS `text-emphasis` value (default position is correct for JP: over
 * horizontally, right vertically). Returns undefined for `none`/absent so no marks are drawn. */
export function paperEmphasisMarkToCss(mark: PaperEmphasisMark | undefined): string | undefined {
  switch (mark) {
    case 'dot':
      return 'filled dot';
    case 'open-dot':
      return 'open dot';
    case 'sesame':
      return 'filled sesame';
    case 'circle':
      return 'filled circle';
    default:
      return undefined;
  }
}
