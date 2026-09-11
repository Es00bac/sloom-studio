// Pure text layout for the vector-text PDF/X exporter. Given a text string, a content width, and
// typography, it greedily word-wraps into positioned lines and returns per-line baselines + per-run x
// offsets (in points, origin at the text box's top-left, x rightward / y downward). Width measurement
// is injected (`measureText`) so the engine is framework-free and unit-testable; the exporter supplies
// the embedded pdf-lib font's `widthOfTextAtSize`, making the wrap self-consistent with the glyphs it
// will actually draw.

export type PaperTextAlign = 'left' | 'center' | 'right' | 'justify';

export interface TextLayoutInput {
  text: string;
  /** Content width of the text box, in points. */
  maxWidthPt: number;
  fontSizePt: number;
  /** Line advance (CSS line-height equivalent), in points. */
  leadingPt: number;
  align: PaperTextAlign;
  /** Width, in points, of a string set at `fontSizePt` in the target font. */
  measureText: (text: string) => number;
  /**
   * Distance from a line's top to its baseline, in points. Defaults to 0.8·fontSize — a reasonable
   * ascent for most Latin faces; the exporter can pass the font's real ascent for exactness.
   */
  ascentPt?: number;
}

export interface LaidOutRun {
  text: string;
  xPt: number;
}

export interface LaidOutLine {
  runs: LaidOutRun[];
  /** Baseline offset from the text box top, in points. */
  baselineYPt: number;
  /** Rendered width of the line's text (before alignment), in points. */
  widthPt: number;
  text: string;
  /** True for the last visual line of a paragraph (justify leaves these ragged, like CSS). */
  isParagraphEnd: boolean;
}

export interface TextLayoutResult {
  lines: LaidOutLine[];
  /** Total height consumed (last line's advance), in points. */
  totalHeightPt: number;
}

/** Options for the shared, deterministic unit wrapper used by managed composition. */
export interface PaperTextUnitBreakOptions<T> {
  /** Return false when `unit` must remain with its predecessor even when it overflows the target width. */
  canBreakBefore?: (unit: T, index: number, previous: T | undefined) => boolean;
}

/**
 * Deterministically split already-tokenized units at their legal boundaries. The caller owns tokenization and
 * width measurement, which keeps this primitive useful for horizontal text, vertical tategaki, and kinsoku.
 * A forbidden leading unit is deliberately retained with the previous line rather than being silently moved.
 */
export function breakPaperTextUnits<T>(
  units: readonly T[],
  maxWidthPt: number,
  measure: (unit: T) => number,
  options: PaperTextUnitBreakOptions<T> = {},
): T[][] {
  if (units.length === 0) return [];
  const maxWidth = Number.isFinite(maxWidthPt) && maxWidthPt > 0 ? maxWidthPt : Number.POSITIVE_INFINITY;
  const canBreakBefore = options.canBreakBefore ?? (() => true);
  const lines: T[][] = [];
  let current: T[] = [];
  let currentWidth = 0;

  units.forEach((unit, index) => {
    const measured = measure(unit);
    const width = Math.max(0, Number.isFinite(measured) ? measured : 0);
    const previous = current[current.length - 1];
    if (current.length > 0 && currentWidth + width > maxWidth && canBreakBefore(unit, index, previous)) {
      lines.push(current);
      current = [unit];
      currentWidth = width;
      return;
    }
    current.push(unit);
    currentWidth += width;
  });

  if (current.length > 0) lines.push(current);
  return lines;
}

/** Split a paragraph into words, preserving nothing but single-space separators (CSS-collapsed). */
function splitWords(paragraph: string): string[] {
  return paragraph.split(/\s+/).filter((w) => w.length > 0);
}

/** Greedy word-wrap of one paragraph into lines of text that each fit `maxWidthPt`. */
function wrapParagraph(words: string[], maxWidthPt: number, measureText: (t: string) => number): string[] {
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && measureText(candidate) > maxWidthPt) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

/** Lay out `runs` for a single line given its alignment. Justify spreads inter-word gaps. */
function placeLine(
  lineText: string,
  align: PaperTextAlign,
  isParagraphEnd: boolean,
  maxWidthPt: number,
  measureText: (t: string) => number,
): { runs: LaidOutRun[]; widthPt: number } {
  const widthPt = measureText(lineText);
  const words = splitWords(lineText);

  // Justify only interior lines with at least two words; last lines stay ragged (CSS behavior).
  if (align === 'justify' && !isParagraphEnd && words.length > 1) {
    const wordWidths = words.map((w) => measureText(w));
    const wordsWidthTotal = wordWidths.reduce((a, b) => a + b, 0);
    const gaps = words.length - 1;
    const gapPt = (maxWidthPt - wordsWidthTotal) / gaps;
    const runs: LaidOutRun[] = [];
    let x = 0;
    words.forEach((word, i) => {
      runs.push({ text: word, xPt: x });
      x += wordWidths[i] + gapPt;
    });
    return { runs, widthPt: maxWidthPt };
  }

  let xStart = 0;
  if (align === 'right') xStart = maxWidthPt - widthPt;
  else if (align === 'center') xStart = (maxWidthPt - widthPt) / 2;
  return { runs: [{ text: lineText, xPt: xStart }], widthPt };
}

/** Lay out multi-paragraph text into positioned, wrapped lines. */
export function layoutParagraphText(input: TextLayoutInput): TextLayoutResult {
  const { text, maxWidthPt, fontSizePt, leadingPt, align, measureText } = input;
  const ascentPt = input.ascentPt ?? fontSizePt * 0.8;
  const paragraphs = text.split('\n');

  const lines: LaidOutLine[] = [];
  let lineIndex = 0;
  for (const paragraph of paragraphs) {
    const wrapped = wrapParagraph(splitWords(paragraph), maxWidthPt, measureText);
    wrapped.forEach((lineText, i) => {
      const isParagraphEnd = i === wrapped.length - 1;
      const { runs, widthPt } = placeLine(lineText, align, isParagraphEnd, maxWidthPt, measureText);
      lines.push({
        runs,
        baselineYPt: ascentPt + lineIndex * leadingPt,
        widthPt,
        text: lineText,
        isParagraphEnd,
      });
      lineIndex += 1;
    });
  }

  return { lines, totalHeightPt: lineIndex * leadingPt };
}
