// Pure text-composition core for the Paper workspace. Given a story's text, a type spec, and a set
// of frames (each split into column boxes, in mm), it greedily wraps and stacks lines, flowing the
// remainder from one frame's columns into the next. The remainder that does not fit is returned as
// `overset` — the basis for threaded text, column flow, runaround, and overset preflight.
//
// Framework-free and measurement-agnostic: the caller injects a `PaperTextMeasurer` (a real DOM/canvas
// measurer in the app; a deterministic fake in tests).

export interface PaperTextFlowTypeSpec {
  fontFamily: string;
  fontSizePt: number;
  leadingPt: number;
  tracking: number;
  align: 'left' | 'center' | 'right' | 'justify';
  fontWeight?: string;
  fontStyle?: string;
  fontStretch?: string;
  fontVariationSettings?: Record<string, number>;
  fontKerning?: 'auto' | 'normal' | 'none';
  firstLineIndentMm?: number;
  spaceBeforeMm?: number;
  spaceAfterMm?: number;
  dropCapLines?: number;
  /**
   * Japanese vertical writing (縦書き). When set, each text line runs down the frame's HEIGHT and
   * successive lines (columns) advance right-to-left across its WIDTH — so the flow engine's capacity
   * and overset are computed on the swapped axis. CJK text also breaks per character with kinsoku,
   * independent of this flag (see `tokenize`).
   */
  vertical?: boolean;
}

export interface PaperTextFlowColumn {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface PaperTextFlowFrame {
  id: string;
  columns: PaperTextFlowColumn[];
  /** Obstacles to flow around inside THIS frame (frame-local mm). Overrides the call-wide default. */
  exclusions?: PaperTextFlowExclusion[];
  /** Destination-frame typography. When omitted, the call-wide `spec` remains authoritative. */
  typeSpec?: PaperTextFlowTypeSpec;
}

/** A source span that must be assigned atomically. Used by rich list prefixes (`marker + "\t"`). */
export interface PaperTextFlowProtectedSpan {
  start: number;
  end: number;
}

/** Run-level typography in the flattened rich source. Unset fields inherit the destination frame. */
export interface PaperTextFlowStyleSpan extends PaperTextFlowProtectedSpan {
  typeSpec: Partial<PaperTextFlowTypeSpec>;
}

/** Paragraph geometry in the flattened rich source. Paragraphs are in source order, including blanks. */
export interface PaperTextFlowParagraphMetrics extends PaperTextFlowProtectedSpan {
  /** First run character after any protected list prefix. */
  contentStart?: number;
  align?: PaperTextFlowTypeSpec['align'];
  leadingPt?: number;
  firstLineIndentMm?: number;
  leftIndentMm?: number;
  rightIndentMm?: number;
  hangingIndentMm?: number;
  listMarkerIndentMm?: number;
  spaceBeforeMm?: number;
  spaceAfterMm?: number;
  borderPaddingMm?: number;
  dropCapLines?: number;
}

/** Optional source-aware metrics used when flowing authoritative rich text. */
export interface PaperTextFlowSourceMetrics {
  protectedSpans?: PaperTextFlowProtectedSpan[];
  styleSpans?: PaperTextFlowStyleSpan[];
  paragraphs?: PaperTextFlowParagraphMetrics[];
  /** Exact source ranges inserted between structural rich paragraphs; authored run delimiters are excluded. */
  structuralDelimiters?: PaperTextFlowProtectedSpan[];
}

export interface PaperTextFlowPoint {
  xMm: number;
  yMm: number;
}

/**
 * An obstacle outline (in the same frame-local mm space as the columns) that text must flow around,
 * with an optional standoff gap kept clear on every side. Powers text wrap / runaround: each line's
 * usable box is narrowed to the widest sub-interval of its column not covered by an exclusion band.
 */
export interface PaperTextFlowExclusion {
  points: PaperTextFlowPoint[];
  standoffMm?: number;
}

/** Width in mm of a rendered text fragment at the given type spec. */
export type PaperTextMeasurer = (text: string, spec: PaperTextFlowTypeSpec) => number;

export interface PaperTextFlowLine {
  text: string;
  xMm: number;
  yMm: number;
  widthMm: number;
}

export interface PaperTextFlowFrameResult {
  frameId: string;
  lines: PaperTextFlowLine[];
  /** The contiguous slice of the original text that flowed into this frame (for threaded rendering). */
  sourceText: string;
  /**
   * Authoritative start/end offsets of this frame's slice within the original `text`, such that
   * `text.slice(sourceStart, sourceEnd) === sourceText`. Half-open [start, end). An empty frame reports
   * `sourceStart === sourceEnd`. These are token-precise (never a substring search of the visible text), so a
   * repeated word does not make a frame's slice ambiguous — the basis for slicing rich text by the same window.
   */
  sourceStart: number;
  sourceEnd: number;
}

export interface PaperTextFlowResult {
  frames: PaperTextFlowFrameResult[];
  overset: string;
  fits: boolean;
}

const EPSILON_MM = 1e-6;

function ptToMm(pt: number): number {
  return (pt * 25.4) / 72;
}

function finiteNonNegative(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function finiteSigned(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

interface FlowToken {
  kind: 'word' | 'break';
  text: string;
  start: number;
  end: number;
  /** Paragraph index in the source. A break belongs to the paragraph that follows it. */
  paragraphIndex: number;
  /** Separator to emit BEFORE this token when it is not the first on a line (space for Latin words
   * preceded by whitespace, empty for CJK characters — Japanese has no inter-character spaces). */
  sep: string;
  /** A single CJK character (breakable per-glyph, subject to kinsoku), as opposed to a Latin word. */
  cjk: boolean;
}

// CJK ideographs, kana, and fullwidth/CJK symbols & punctuation, as explicit \u block ranges (CJK
// Symbols/Punctuation, Hiragana+Katakana, CJK Ext A, CJK Unified, CJK Compat Ideographs,
// Halfwidth/Fullwidth Forms). Japanese wraps between (almost) any two, so each is its own unit — unlike Latin, which only breaks at spaces.
const CJK_CHAR =
  /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

// 禁則処理 (kinsoku shori). Characters that may not BEGIN a line (行頭禁則: closing brackets, trailing
// punctuation, small kana, chōonpu, iteration marks) — pulled up onto the previous line (追い込み).
const KINSOKU_LINE_START_FORBIDDEN = new Set(
  Array.from(
    '、。，．・：；？！ゝゞ々ー‐）］｝〕〉》」』】〙〗｣»’”〟ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ｡｣､',
  ),
);
// Characters that may not END a line (行末禁則: opening brackets/quotes) — pushed down to the next line.
const KINSOKU_LINE_END_FORBIDDEN = new Set(Array.from('（［｛〔〈《「『【〘〖｢«‘“〝｟'));

function isCjkChar(ch: string): boolean {
  return CJK_CHAR.test(ch);
}

function tokenize(text: string, protectedSpans: readonly PaperTextFlowProtectedSpan[] = []): FlowToken[] {
  const tokens: FlowToken[] = [];
  const lines = text.split('\n');
  let offset = 0;

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      tokens.push({ kind: 'break', text: '\n', start: offset - 1, end: offset, paragraphIndex: lineIndex, sep: '', cjk: false });
    }
    // Walk the line: whitespace separates Latin words; each CJK glyph is its own unit; a run of
    // non-space, non-CJK characters is one Latin "word". `sep` records whether whitespace preceded a
    // unit so the reconstructed line text (and thus its measured width) stays faithful to the source.
    const chars = Array.from(line);
    let i = 0;
    let charOffset = 0;
    let pendingSpace = false;
    while (i < chars.length) {
      const ch = chars[i];
      if (/\s/.test(ch)) {
        pendingSpace = true;
        charOffset += ch.length;
        i += 1;
        continue;
      }
      if (isCjkChar(ch)) {
        const start = offset + charOffset;
        tokens.push({ kind: 'word', text: ch, start, end: start + ch.length, paragraphIndex: lineIndex, sep: pendingSpace ? ' ' : '', cjk: true });
        pendingSpace = false;
        charOffset += ch.length;
        i += 1;
        continue;
      }
      // Accumulate a Latin word up to the next whitespace or CJK char.
      let word = '';
      const wordStart = charOffset;
      while (i < chars.length && !/\s/.test(chars[i]) && !isCjkChar(chars[i])) {
        word += chars[i];
        charOffset += chars[i].length;
        i += 1;
      }
      const start = offset + wordStart;
      tokens.push({ kind: 'word', text: word, start, end: start + word.length, paragraphIndex: lineIndex, sep: pendingSpace ? ' ' : '', cjk: false });
      pendingSpace = false;
    }
    offset += line.length + 1;
  });

  // Replace every token that overlaps a protected source span with one indivisible word token. This is
  // deliberately source-coordinate based: a rich list prefix such as "10.\t" stays atomic even though the
  // ordinary tokenizer would otherwise see the marker and its tab as separate wrapping opportunities.
  for (const rawSpan of [...protectedSpans].sort((left, right) => left.start - right.start)) {
    const start = Math.max(0, Math.min(text.length, Math.floor(rawSpan.start)));
    const end = Math.max(start, Math.min(text.length, Math.floor(rawSpan.end)));
    if (end <= start) continue;
    const firstOverlap = tokens.findIndex((token) => token.end > start && token.start < end);
    const insertionIndex = firstOverlap >= 0
      ? firstOverlap
      : tokens.findIndex((token) => token.start >= end);
    const paragraphIndex = text.slice(0, start).split('\n').length - 1;
    const prior = firstOverlap >= 0 ? tokens[firstOverlap] : undefined;
    const protectedToken: FlowToken = {
      kind: 'word',
      text: text.slice(start, end),
      start,
      end,
      paragraphIndex,
      sep: prior?.sep ?? '',
      cjk: false,
    };
    const kept = tokens.filter((token) => token.end <= start || token.start >= end);
    const targetIndex = insertionIndex < 0 ? kept.length : kept.findIndex((token) => token.start >= end);
    const protectedIndex = targetIndex < 0 ? kept.length : targetIndex;
    kept.splice(protectedIndex, 0, protectedToken);
    if (/\s$/u.test(protectedToken.text) && kept[protectedIndex + 1]?.kind === 'word') {
      kept[protectedIndex + 1].sep = '';
    }
    tokens.splice(0, tokens.length, ...kept);
  }

  // A separator-only story still owns one blank line and its exact source bytes. Without a synthetic break,
  // there is no progress token from which a frame can derive a range (ordinary leading/trailing whitespace
  // around real words is already covered by the consumed-interval range calculation below).
  if (tokens.length === 0 && text.length > 0) {
    tokens.push({ kind: 'break', text: '', start: 0, end: text.length, paragraphIndex: 0, sep: '', cjk: false });
  }

  return tokens;
}

interface NextLineResult {
  text: string;
  widthMm: number;
  nextIndex: number;
  leadingMm: number;
  paragraphIndex: number;
  isParagraphEnd: boolean;
}

/** Reconstruct a line's text from its chosen units, honouring each unit's leading separator (the first
 * unit never gets one). CJK units concatenate with no space; Latin words keep their source spacing. */
function joinUnits(units: FlowToken[]): string {
  let out = '';
  for (let i = 0; i < units.length; i += 1) {
    out += i === 0 ? units[i].text : units[i].sep + units[i].text;
  }
  return out;
}

function buildNextLine(
  tokens: FlowToken[],
  startIndex: number,
  lineBudgetMm: number,
  measure: PaperTextMeasurer,
  spec: PaperTextFlowTypeSpec,
  sourceText: string,
  sourceMetrics: PaperTextFlowSourceMetrics | undefined,
): NextLineResult {
  let index = startIndex;
  const paragraphIndex = tokens[index]?.paragraphIndex ?? (sourceMetrics?.paragraphs?.length ?? 1) - 1;
  const safeLineBudgetMm = finiteNonNegative(lineBudgetMm);

  // A paragraph break terminates the previous line; the next line starts after it.
  if (index < tokens.length && tokens[index].kind === 'break') {
    index += 1;
  }

  if (safeLineBudgetMm <= EPSILON_MM && index < tokens.length && tokens[index].kind === 'word') {
    return {
      text: '',
      widthMm: 0,
      nextIndex: startIndex,
      leadingMm: lineLeadingMm([], paragraphIndex, spec, sourceMetrics),
      paragraphIndex,
      isParagraphEnd: false,
    };
  }

  const chosen: FlowToken[] = [];
  while (index < tokens.length && tokens[index].kind === 'word') {
    const candidate = [...chosen, tokens[index]];
    const candidateWidth = measureFlowUnits(candidate, sourceText, measure, spec, sourceMetrics);
    if (!Number.isFinite(candidateWidth)) break;
    if (chosen.length === 0 || candidateWidth <= safeLineBudgetMm + EPSILON_MM) {
      chosen.push(tokens[index]);
      index += 1;
      // A single unit wider than the line budget is placed alone, then the line ends.
      if (candidateWidth > safeLineBudgetMm + EPSILON_MM) {
        break;
      }
    } else {
      break;
    }
  }

  // --- 禁則処理 (kinsoku shori) — only bites on CJK punctuation; Latin lines are unaffected ---
  // 行末禁則: a line must not END on an opening bracket/quote; push it down to the next line (unless it
  // is the line's only unit, which would loop forever / leave an empty line).
  while (chosen.length > 1 && KINSOKU_LINE_END_FORBIDDEN.has(chosen[chosen.length - 1].text)) {
    chosen.pop();
    index -= 1;
  }
  // 行頭禁則: the next line must not START with closing punctuation (。、」…); pull such characters up onto
  // this line (追い込み). Capped so a pathological run can't overflow the frame unboundedly.
  let pulled = 0;
  while (
    index < tokens.length &&
    tokens[index].kind === 'word' &&
    chosen.length > 0 &&
    pulled < 4 &&
    KINSOKU_LINE_START_FORBIDDEN.has(tokens[index].text)
  ) {
    chosen.push(tokens[index]);
    index += 1;
    pulled += 1;
  }

  const text = joinUnits(chosen);
  const widthMm = text ? measureFlowUnits(chosen, sourceText, measure, spec, sourceMetrics) : 0;
  const leadingMm = lineLeadingMm(chosen, paragraphIndex, spec, sourceMetrics);
  return {
    text,
    widthMm,
    nextIndex: index,
    leadingMm,
    paragraphIndex,
    isParagraphEnd: index >= tokens.length || tokens[index].kind === 'break',
  };
}

function paragraphMetricsAt(
  paragraphIndex: number,
  sourceMetrics: PaperTextFlowSourceMetrics | undefined,
): PaperTextFlowParagraphMetrics | undefined {
  return sourceMetrics?.paragraphs?.[paragraphIndex];
}

function resolvedSourceSpec(
  sourceOffset: number,
  paragraphIndex: number,
  base: PaperTextFlowTypeSpec,
  sourceMetrics: PaperTextFlowSourceMetrics | undefined,
): PaperTextFlowTypeSpec {
  const paragraph = paragraphMetricsAt(paragraphIndex, sourceMetrics);
  const run = sourceMetrics?.styleSpans?.find((span) => sourceOffset >= span.start && sourceOffset < span.end);
  return {
    ...base,
    ...(paragraph?.align ? { align: paragraph.align } : {}),
    ...(paragraph?.leadingPt != null ? { leadingPt: paragraph.leadingPt } : {}),
    ...(run?.typeSpec ?? {}),
  };
}

function measureFlowUnits(
  units: FlowToken[],
  sourceText: string,
  measure: PaperTextMeasurer,
  baseSpec: PaperTextFlowTypeSpec,
  sourceMetrics: PaperTextFlowSourceMetrics | undefined,
): number {
  if (!sourceMetrics) {
    const measured = measure(joinUnits(units), baseSpec);
    return Number.isFinite(measured) && measured >= 0 ? measured : Number.POSITIVE_INFINITY;
  }
  let widthMm = 0;
  units.forEach((unit, index) => {
    const unitSpec = resolvedSourceSpec(unit.start, unit.paragraphIndex, baseSpec, sourceMetrics);
    if (index > 0 && unit.sep) {
      const separatorWidth = measure(unit.sep, unitSpec);
      if (!Number.isFinite(separatorWidth) || separatorWidth < 0) {
        widthMm = Number.POSITIVE_INFINITY;
        return;
      }
      widthMm += separatorWidth;
    }
    const boundaries = new Set([unit.start, unit.end]);
    for (const span of sourceMetrics.styleSpans ?? []) {
      if (span.start > unit.start && span.start < unit.end) boundaries.add(span.start);
      if (span.end > unit.start && span.end < unit.end) boundaries.add(span.end);
    }
    const ordered = [...boundaries].sort((left, right) => left - right);
    for (let segment = 0; segment < ordered.length - 1; segment += 1) {
      const start = ordered[segment];
      const end = ordered[segment + 1];
      const sourceSegment = sourceText.slice(start, end);
      const measuredSegment = sourceMetrics.protectedSpans?.some((span) => start >= span.start && end <= span.end)
        ? sourceSegment.replace(/\t/g, '\u2003')
        : sourceSegment;
      const segmentWidth = measure(
        measuredSegment,
        resolvedSourceSpec(start, unit.paragraphIndex, baseSpec, sourceMetrics),
      );
      if (!Number.isFinite(segmentWidth) || segmentWidth < 0) {
        widthMm = Number.POSITIVE_INFINITY;
        return;
      }
      widthMm += segmentWidth;
    }
  });
  return widthMm;
}

function lineLeadingMm(
  units: FlowToken[],
  paragraphIndex: number,
  baseSpec: PaperTextFlowTypeSpec,
  sourceMetrics: PaperTextFlowSourceMetrics | undefined,
): number {
  if (!sourceMetrics) {
    const fontSizePt = finiteNonNegative(baseSpec.fontSizePt, 1);
    const leadingPt = finiteNonNegative(baseSpec.leadingPt, fontSizePt * 1.2);
    return ptToMm(leadingPt > 0 ? leadingPt : fontSizePt * 1.2);
  }
  const offsets = units.length > 0
    ? units.flatMap((unit) => [
        unit.start,
        ...(sourceMetrics.styleSpans ?? [])
          .filter((span) => span.start > unit.start && span.start < unit.end)
          .map((span) => span.start),
      ])
    : [paragraphMetricsAt(paragraphIndex, sourceMetrics)?.start ?? 0];
  return Math.max(...offsets.map((offset) => {
    const resolved = resolvedSourceSpec(offset, paragraphIndex, baseSpec, sourceMetrics);
    const fontSizePt = finiteNonNegative(resolved.fontSizePt, 1);
    const leadingPt = finiteNonNegative(resolved.leadingPt);
    return ptToMm(Math.max(leadingPt, fontSizePt * 1.2));
  }));
}

function alignLineX(box: { xMm: number; widthMm: number }, widthMm: number, align: PaperTextFlowTypeSpec['align']): number {
  switch (align) {
    case 'right':
      return box.xMm + box.widthMm - widthMm;
    case 'center':
      return box.xMm + (box.widthMm - widthMm) / 2;
    default:
      return box.xMm;
  }
}

/**
 * Horizontal extent [leftMm, rightMm] of a polygon's boundary across the vertical band [yTop, yBot],
 * or null when the polygon does not occupy the band. Sampling endpoints-in-band plus the edge crossings
 * at the band edges yields the exact extreme x for piecewise-linear (polygon) boundaries.
 */
function polygonBandExtent(points: PaperTextFlowPoint[], yTop: number, yBot: number): [number, number] | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let hit = false;
  const consider = (x: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    hit = true;
  };

  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const edgeTop = Math.min(a.yMm, b.yMm);
    const edgeBot = Math.max(a.yMm, b.yMm);
    if (edgeBot < yTop - EPSILON_MM || edgeTop > yBot + EPSILON_MM) continue;

    if (a.yMm >= yTop - EPSILON_MM && a.yMm <= yBot + EPSILON_MM) consider(a.xMm);
    if (b.yMm >= yTop - EPSILON_MM && b.yMm <= yBot + EPSILON_MM) consider(b.xMm);

    const dy = b.yMm - a.yMm;
    if (Math.abs(dy) > EPSILON_MM) {
      for (const yy of [yTop, yBot]) {
        if (yy >= edgeTop - EPSILON_MM && yy <= edgeBot + EPSILON_MM) {
          consider(a.xMm + ((b.xMm - a.xMm) * (yy - a.yMm)) / dy);
        }
      }
    }
  }

  return hit ? [minX, maxX] : null;
}

/** The blocked x-interval an exclusion imposes on the band [yTop, yBot], inflated by its standoff. */
function bandBlockedInterval(exclusion: PaperTextFlowExclusion, yTop: number, yBot: number): [number, number] | null {
  const standoff = Math.max(0, exclusion.standoffMm ?? 0);
  const extent = polygonBandExtent(exclusion.points, yTop - standoff, yBot + standoff);
  if (!extent) return null;
  return [extent[0] - standoff, extent[1] + standoff];
}

/** Free sub-intervals of `base` after removing every blocked interval (sorted, left to right). */
function subtractIntervals(base: [number, number], blocks: [number, number][]): [number, number][] {
  const merged = blocks
    .map(([l, r]): [number, number] => [Math.max(l, base[0]), Math.min(r, base[1])])
    .filter(([l, r]) => r - l > EPSILON_MM)
    .sort((a, b) => a[0] - b[0]);

  const free: [number, number][] = [];
  let cursor = base[0];
  for (const [l, r] of merged) {
    if (r <= cursor) continue;
    if (l > cursor) free.push([cursor, l]);
    cursor = Math.max(cursor, r);
    if (cursor >= base[1]) break;
  }
  if (cursor < base[1] - EPSILON_MM) free.push([cursor, base[1]]);
  return free.filter(([l, r]) => r - l > EPSILON_MM);
}

/** A band narrower than this (mm) is treated as fully blocked — text skips down past the obstacle. */
const MIN_RUNAROUND_LINE_MM = 2;

export function flowPaperText(
  text: string,
  spec: PaperTextFlowTypeSpec,
  frames: PaperTextFlowFrame[],
  measure: PaperTextMeasurer,
  exclusions: PaperTextFlowExclusion[] = [],
  sourceMetrics?: PaperTextFlowSourceMetrics,
): PaperTextFlowResult {
  const tokens = tokenize(text, sourceMetrics?.protectedSpans);
  let index = 0;
  const paragraphLineCounts = new Map<number, number>();
  let previousFrameHasWords = false;

  const frameResults: PaperTextFlowFrameResult[] = frames.map((frame) => {
    const frameStartIndex = index;
    const lines: PaperTextFlowLine[] = [];
    const frameExclusions = frame.exclusions ?? exclusions;
    const frameSpec = frame.typeSpec ?? spec;

    for (const column of frame.columns) {
      // 縦書き (vertical-rl): each text line runs down the column HEIGHT and successive lines advance
      // right-to-left across its WIDTH, so the axes swap. Runaround exclusions (horizontal bands) don't
      // apply, so the vertical path is a clean column fill — its job here is capacity/overset, and the
      // browser renders the glyphs via CSS `writing-mode`.
      if (frameSpec.vertical) {
        const columnWidthMm = finiteNonNegative(column.widthMm);
        const columnHeightMm = finiteNonNegative(column.heightMm);
        const columnRight = finiteSigned(column.xMm) + columnWidthMm; // the first text-line sits at the right edge
        let used = 0; // width consumed by placed text-lines

        while (index < tokens.length) {
          const paragraphIndex = tokens[index].paragraphIndex;
          const paragraph = paragraphMetricsAt(paragraphIndex, sourceMetrics);
          const paragraphLineIndex = paragraphLineCounts.get(paragraphIndex) ?? 0;
          const startAdvanceMm = paragraphStartAdvanceMm(paragraph, paragraphLineIndex, frameSpec);
          const candidateUsed = used + startAdvanceMm;
          const lineBox = paragraphLineBox(
            { xMm: finiteSigned(column.yMm), widthMm: columnHeightMm },
            paragraph,
            paragraphLineIndex,
            text,
            measure,
            frameSpec,
            sourceMetrics,
          );
          const line = buildNextLine(tokens, index, lineBox.widthMm, measure, frameSpec, text, sourceMetrics);
          if (line.nextIndex === index) break;
          const endAdvanceMm = line.isParagraphEnd ? paragraphEndAdvanceMm(paragraph, frameSpec) : 0;
          if (candidateUsed + line.leadingMm + endAdvanceMm > columnWidthMm + EPSILON_MM) break;

          lines.push({
            text: line.text,
            xMm: columnRight - candidateUsed - line.leadingMm, // nominal (not consumed downstream): lines march leftward
            yMm: lineBox.xMm,
            widthMm: line.widthMm,
          });
          used = candidateUsed + line.leadingMm + endAdvanceMm;
          index = line.nextIndex;
          paragraphLineCounts.set(line.paragraphIndex, paragraphLineIndex + 1);
        }
        continue;
      }

      const columnHeightMm = finiteNonNegative(column.heightMm);
      const columnBottom = finiteSigned(column.yMm) + columnHeightMm;
      let y = finiteSigned(column.yMm);

      while (index < tokens.length) {
        const paragraphIndex = tokens[index].paragraphIndex;
        const paragraph = paragraphMetricsAt(paragraphIndex, sourceMetrics);
        const paragraphLineIndex = paragraphLineCounts.get(paragraphIndex) ?? 0;
        const paragraphStartInset = paragraphStartAdvanceMm(paragraph, paragraphLineIndex, frameSpec);
        const candidateY = y + paragraphStartInset;
        const nominalLeadingMm = lineLeadingMm([], paragraphIndex, frameSpec, sourceMetrics);
        // Narrow the line's usable box to the widest part of the column left clear by any exclusion
        // band; a fully blocked band is skipped so the text resumes below the obstacle.
        let lineBox: { xMm: number; widthMm: number } = {
          xMm: finiteSigned(column.xMm),
          widthMm: finiteNonNegative(column.widthMm),
        };
        if (frameExclusions.length > 0) {
          const blocks: [number, number][] = [];
          for (const exclusion of frameExclusions) {
            const blocked = bandBlockedInterval(exclusion, candidateY, candidateY + nominalLeadingMm);
            if (blocked) blocks.push(blocked);
          }
          if (blocks.length > 0) {
            const free = subtractIntervals([lineBox.xMm, lineBox.xMm + lineBox.widthMm], blocks);
            const widest = free.reduce<[number, number] | null>(
              (best, cur) => (best === null || cur[1] - cur[0] > best[1] - best[0] ? cur : best),
              null,
            );
            if (!widest || widest[1] - widest[0] < MIN_RUNAROUND_LINE_MM) {
              y += nominalLeadingMm;
              continue;
            }
            lineBox = { xMm: widest[0], widthMm: widest[1] - widest[0] };
          }
        }

        lineBox = paragraphLineBox(lineBox, paragraph, paragraphLineIndex, text, measure, frameSpec, sourceMetrics);
        const line = buildNextLine(tokens, index, lineBox.widthMm, measure, frameSpec, text, sourceMetrics);
        if (line.nextIndex === index) {
          break;
        }
        const paragraphEndInset = line.isParagraphEnd ? paragraphEndAdvanceMm(paragraph, frameSpec) : 0;
        if (candidateY + line.leadingMm + paragraphEndInset > columnBottom + EPSILON_MM) break;

        lines.push({
          text: line.text,
          xMm: alignLineX(lineBox, line.widthMm, resolvedSourceSpec(tokens[index].start, paragraphIndex, frameSpec, sourceMetrics).align),
          yMm: candidateY,
          widthMm: line.widthMm,
        });
        y = candidateY + line.leadingMm + paragraphEndInset;
        index = line.nextIndex;
        paragraphLineCounts.set(paragraphIndex, paragraphLineIndex + 1);
      }
    }

    // Ownership follows every consumed token plus the separators leading into it. Plain source has no derived
    // delimiters, so every authored byte remains owned by a frame or overset. Rich presentation may omit only a
    // mapped structural paragraph delimiter. Consecutive/edge/blank-only delimiters stay owned exactly once.
    const consumed = index > frameStartIndex;
    const hasWords = tokens.slice(frameStartIndex, index).some((token) => token.kind === 'word');
    const rawSourceStart = frameStartIndex === 0 ? 0 : tokens[frameStartIndex - 1].end;
    const rawSourceEnd = consumed
      ? (index >= tokens.length ? text.length : tokens[index - 1].end)
      : rawSourceStart;
    const skippedDelimiterLength = consumed && previousFrameHasWords && hasWords
      ? presentationDelimiterLengthAt(text, rawSourceStart, sourceMetrics)
      : 0;
    const sourceStart = skippedDelimiterLength > 0
      ? rawSourceStart + skippedDelimiterLength
      : rawSourceStart;
    const sourceEnd = Math.max(sourceStart, rawSourceEnd);
    const sourceText = text.slice(sourceStart, sourceEnd);
    previousFrameHasWords = hasWords;

    return { frameId: frame.id, lines, sourceText, sourceStart, sourceEnd };
  });

  let overset = '';
  if (index < tokens.length) {
    const rawOversetStart = index === 0 ? 0 : tokens[index - 1].end;
    const oversetHasWords = tokens.slice(index).some((token) => token.kind === 'word');
    const skippedDelimiterLength = previousFrameHasWords && oversetHasWords
      ? presentationDelimiterLengthAt(text, rawOversetStart, sourceMetrics)
      : 0;
    const oversetStart = skippedDelimiterLength > 0
      ? rawOversetStart + skippedDelimiterLength
      : rawOversetStart;
    overset = text.slice(oversetStart);
  }
  return { frames: frameResults, overset, fits: index >= tokens.length };
}

function presentationDelimiterLengthAt(
  text: string,
  offset: number,
  sourceMetrics: PaperTextFlowSourceMetrics | undefined,
): number {
  // Plain flow has no structural source metadata, so every delimiter is authored and must remain owned. Rich
  // flow has authoritative provenance and may hide only an exact structural paragraph range; the character
  // value alone never makes an authored run delimiter structural.
  if (!sourceMetrics) return 0;
  const structural = sourceMetrics.structuralDelimiters?.find((span) => span.start === offset);
  if (!structural) return 0;
  const start = Math.max(0, Math.min(text.length, Math.floor(structural.start)));
  const end = Math.max(start, Math.min(text.length, Math.floor(structural.end)));
  return start === offset && end === start + 1 && text.slice(start, end) === '\n' ? 1 : 0;
}

function paragraphStartAdvanceMm(
  paragraph: PaperTextFlowParagraphMetrics | undefined,
  lineIndex: number,
  frameSpec: PaperTextFlowTypeSpec,
): number {
  if (lineIndex !== 0) return 0;
  return finiteNonNegative(paragraph?.spaceBeforeMm ?? frameSpec.spaceBeforeMm)
    + finiteNonNegative(paragraph?.borderPaddingMm);
}

function paragraphEndAdvanceMm(
  paragraph: PaperTextFlowParagraphMetrics | undefined,
  frameSpec: PaperTextFlowTypeSpec,
): number {
  return finiteNonNegative(paragraph?.borderPaddingMm)
    + finiteNonNegative(paragraph?.spaceAfterMm ?? frameSpec.spaceAfterMm);
}

function paragraphLineBox(
  box: { xMm: number; widthMm: number },
  paragraph: PaperTextFlowParagraphMetrics | undefined,
  lineIndex: number,
  sourceText: string,
  measure: PaperTextMeasurer,
  frameSpec: PaperTextFlowTypeSpec,
  sourceMetrics: PaperTextFlowSourceMetrics | undefined,
): { xMm: number; widthMm: number } {
  const safeBox = { xMm: finiteSigned(box.xMm), widthMm: finiteNonNegative(box.widthMm) };
  if (!paragraph) return safeBox;
  const border = finiteNonNegative(paragraph.borderPaddingMm);
  const marker = finiteNonNegative(paragraph.listMarkerIndentMm);
  const left = finiteNonNegative(paragraph.leftIndentMm) + border + marker;
  const right = finiteNonNegative(paragraph.rightIndentMm) + border;
  let lineOffset = 0;
  if (lineIndex === 0) {
    if (marker > 0) lineOffset = -marker;
    else if (finiteNonNegative(paragraph.hangingIndentMm) > 0) lineOffset = -finiteNonNegative(paragraph.hangingIndentMm);
    else lineOffset = finiteSigned(paragraph.firstLineIndentMm ?? frameSpec.firstLineIndentMm);
  }
  const dropCapLines = finiteNonNegative(paragraph.dropCapLines ?? frameSpec.dropCapLines);
  if (lineIndex < dropCapLines) {
    const contentStart = paragraph.contentStart ?? paragraph.start;
    const firstCharacter = Array.from(sourceText.slice(contentStart, paragraph.end).trimStart())[0];
    if (firstCharacter) {
      const paragraphIndex = Math.max(0, sourceMetrics?.paragraphs?.indexOf(paragraph) ?? 0);
      const base = resolvedSourceSpec(contentStart, paragraphIndex, frameSpec, sourceMetrics);
      const baseFontSizePt = finiteNonNegative(base.fontSizePt, 1);
      const scaled = { ...base, fontSizePt: baseFontSizePt * Math.max(2, dropCapLines) };
      const scaledWidth = measure(firstCharacter, scaled);
      const baseWidth = measure(firstCharacter, base);
      const reserve = Number.isFinite(scaledWidth) && scaledWidth >= 0
        ? scaledWidth + ptToMm(scaled.fontSizePt * 0.08)
        : safeBox.widthMm;
      lineOffset += lineIndex === 0
        ? Math.max(0, reserve - (Number.isFinite(baseWidth) && baseWidth >= 0 ? baseWidth : 0))
        : reserve;
    }
  }
  const xMm = safeBox.xMm + left + lineOffset;
  const widthMm = finiteNonNegative(safeBox.widthMm - left - right - lineOffset);
  return { xMm, widthMm };
}
