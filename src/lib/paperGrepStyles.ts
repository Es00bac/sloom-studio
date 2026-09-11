// Document-level GREP styles and nested styles for Paper rich text.
//
// This module is the single deterministic engine for rule validation, character-style resolution,
// and the explicit application pass that rewrites rich-text runs. Rules are retained on the
// document; applying them is a deliberate, undoable edit — spans become ordinary run properties,
// so managed composition, print HTML, and PDF/X inherit the styling through the existing rich-run
// pipeline with no renderer changes.

import type {
  PaperGrepStyleRule,
  PaperNestedStyleStep,
  PaperRichParagraph,
  PaperStyleCatalogs,
  PaperTextRun,
  PaperTypography,
} from '../types/paper';

/** Bounds that keep authored patterns and the matcher predictable. */
export const PAPER_GREP_STYLE_LIMITS = {
  maxPatternLength: 200,
  maxRuleCount: 24,
  maxNestedStepCount: 8,
  maxRepeat: 50,
  maxMatchesPerParagraph: 1000,
  maxRuleNameLength: 64,
} as const;

export type PaperGrepPatternInvalidReason = 'empty' | 'too-long' | 'invalid-regex' | 'unsafe-regex';

export type PaperGrepPatternValidation =
  | { ok: true }
  | { ok: false; reason: PaperGrepPatternInvalidReason };

function isRegexQuantifier(pattern: string, index: number): number {
  const token = pattern[index];
  if (token === '*' || token === '+' || token === '?') return index + 1;
  if (token !== '{') return index;
  const end = pattern.indexOf('}', index + 1);
  if (end < 0 || !/^\{\d+(?:,\d*)?\}$/.test(pattern.slice(index, end + 1))) return index;
  return end + 1;
}

/**
 * Reject the nested-quantifier shape that can make backtracking regex engines take
 * exponential time. Matching runs synchronously in the Paper inspector, so a
 * conservative source policy is preferable to accepting a pattern we cannot bound.
 */
function hasUnsafeNestedQuantifier(pattern: string): boolean {
  const groups: Array<{ hasQuantifier: boolean; hasAlternation: boolean }> = [];
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const token = pattern[index];
    if (token === '\\') {
      if (/\d/.test(pattern[index + 1] ?? '')) return true;
      index += 1;
      continue;
    }
    if (token === '[') {
      inClass = true;
      continue;
    }
    if (token === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;
    if (token === '(') {
      groups.push({ hasQuantifier: false, hasAlternation: false });
      continue;
    }
    if (token === '|' && groups.length > 0) {
      groups[groups.length - 1].hasAlternation = true;
      continue;
    }
    if (token === ')') {
      const group = groups.pop();
      const hasQuantifier = group?.hasQuantifier ?? false;
      const quantifierEnd = isRegexQuantifier(pattern, index + 1);
      if ((hasQuantifier || group?.hasAlternation) && quantifierEnd > index + 1) return true;
      if ((hasQuantifier || group?.hasAlternation || quantifierEnd > index + 1) && groups.length > 0) {
        groups[groups.length - 1].hasQuantifier = true;
      }
      continue;
    }
    if (isRegexQuantifier(pattern, index) > index) {
      if (groups.length > 0) groups[groups.length - 1].hasQuantifier = true;
      index = isRegexQuantifier(pattern, index) - 1;
    }
  }
  return false;
}

/** Validate one pattern source against the documented bounded ECMAScript subset. */
export function validatePaperGrepPattern(pattern: string): PaperGrepPatternValidation {
  if (typeof pattern !== 'string' || pattern.length === 0) return { ok: false, reason: 'empty' };
  if (pattern.length > PAPER_GREP_STYLE_LIMITS.maxPatternLength) return { ok: false, reason: 'too-long' };
  if (hasUnsafeNestedQuantifier(pattern)) return { ok: false, reason: 'unsafe-regex' };
  try {
    void new RegExp(pattern, 'u');
  } catch {
    return { ok: false, reason: 'invalid-regex' };
  }
  return { ok: true };
}

function compilePattern(rule: Pick<PaperGrepStyleRule, 'pattern' | 'caseInsensitive'>): RegExp | undefined {
  if (validatePaperGrepPattern(rule.pattern).ok !== true) return undefined;
  try {
    return new RegExp(rule.pattern, rule.caseInsensitive ? 'giu' : 'gu');
  } catch {
    return undefined;
  }
}

/** Character-style typography with `basedOn` ancestors resolved first (cycle-safe). */
export function resolvePaperCharacterStyleTypography(
  styles: PaperStyleCatalogs,
  characterStyleId: string,
): Partial<PaperTypography> | undefined {
  const seen = new Set<string>();
  const chain: Array<Partial<PaperTypography>> = [];
  let currentId: string | undefined = characterStyleId;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const style = styles.character.find((candidate) => candidate.id === currentId);
    if (!style) break;
    chain.unshift(style.typography);
    currentId = style.basedOnId;
  }
  if (chain.length === 0) return undefined;
  return Object.assign({}, ...chain);
}

/** Typography keys that map one-to-one onto rich-run properties (same names and semantics). */
const RUN_STYLE_KEYS = [
  'fontFamily',
  'fontSizePt',
  'fontWeight',
  'fontStyle',
  'color',
  'tracking',
  'smallCaps',
  'numericStyle',
  'fontKerning',
  'fontStretch',
  'fontVariationSettings',
] as const;

type RunStyleKey = typeof RUN_STYLE_KEYS[number];
type RunOverlay = Partial<Record<RunStyleKey, PaperTextRun[RunStyleKey]>>;

function runOverlayForStyle(styles: PaperStyleCatalogs, characterStyleId: string): RunOverlay | undefined {
  const typography = resolvePaperCharacterStyleTypography(styles, characterStyleId);
  if (!typography) return undefined;
  const overlay: Record<string, unknown> = {};
  let defined = 0;
  for (const key of RUN_STYLE_KEYS) {
    const value = typography[key];
    if (value !== undefined) {
      overlay[key] = value;
      defined += 1;
    }
  }
  return defined > 0 ? (overlay as RunOverlay) : undefined;
}

interface Segment {
  start: number;
  end: number;
  /** Application order index; the highest index covering an offset wins. */
  order: number;
  overlay: RunOverlay;
}

/** Nested-style segments for one paragraph's concatenated text, consumed from offset 0 in order. */
function nestedSegments(
  paragraphText: string,
  steps: readonly PaperNestedStyleStep[],
  overlays: Map<string, RunOverlay>,
): Segment[] {
  const segments: Segment[] = [];
  let offset = 0;
  let order = 0;
  for (const step of steps) {
    if (offset >= paragraphText.length) break;
    const overlay = overlays.get(step.characterStyleId);
    if (!overlay) continue;
    if (step.delimiterPattern === '') {
      segments.push({ start: offset, end: paragraphText.length, order, overlay });
      offset = paragraphText.length;
      break;
    }
    const pattern = compilePattern({ pattern: step.delimiterPattern, caseInsensitive: false });
    if (!pattern) continue;
    let matched = 0;
    let boundary = -1;
    let scan = offset;
    while (matched < step.repeat) {
      pattern.lastIndex = scan;
      const match = pattern.exec(paragraphText);
      if (!match || match.index >= paragraphText.length) break;
      if (match[0].length === 0) break;
      matched += 1;
      boundary = step.inclusive ? match.index + match[0].length : match.index;
      scan = match.index + match[0].length;
    }
    if (matched === 0 || boundary <= offset) continue;
    const safeStart = normalizeBoundary(paragraphText, offset, 'start');
    const safeEnd = normalizeBoundary(paragraphText, boundary, 'end');
    if (safeEnd <= safeStart) continue;
    segments.push({ start: safeStart, end: safeEnd, order: order += 1, overlay });
    offset = safeEnd;
  }
  return segments;
}

interface OwnedSegment extends Segment {
  ownerRuleId: string;
}

function grepSegments(
  paragraphText: string,
  rules: readonly PaperGrepStyleRule[],
  overlays: Map<string, RunOverlay>,
  startOrder: number,
): OwnedSegment[] {
  const segments: OwnedSegment[] = [];
  let order = startOrder;
  for (const rule of rules) {
    const overlay = overlays.get(rule.characterStyleId);
    if (!overlay) continue;
    const pattern = compilePattern(rule);
    if (!pattern) continue;
    let count = 0;
    let scan = 0;
    while (count < PAPER_GREP_STYLE_LIMITS.maxMatchesPerParagraph) {
      pattern.lastIndex = scan;
      const match = pattern.exec(paragraphText);
      if (!match) break;
      if (match[0].length === 0) {
        scan = match.index + 1;
        if (scan > paragraphText.length) break;
        continue;
      }
      const start = normalizeBoundary(paragraphText, match.index, 'start');
      const end = normalizeBoundary(paragraphText, match.index + match[0].length, 'end');
      if (end > start) {
        segments.push({ start, end, order: order += 1, overlay, ownerRuleId: rule.id });
      }
      count += 1;
      scan = match.index + match[0].length;
    }
  }
  return segments;
}

function normalizeBoundary(text: string, offset: number, side: 'start' | 'end'): number {
  if (offset > 0 && offset < text.length) {
    const before = text.charCodeAt(offset - 1);
    const after = text.charCodeAt(offset);
    const insideSurrogatePair = before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
    if (insideSurrogatePair) return side === 'start' ? offset - 1 : offset + 1;
  }
  return offset;
}

/** Merge overlays in application order; later rules win only for keys they define. */
function overlayAt(segments: readonly Segment[], offset: number): RunOverlay | undefined {
  const covering = segments
    .filter((segment) => offset >= segment.start && offset < segment.end)
    .sort((left, right) => left.order - right.order);
  if (covering.length === 0) return undefined;
  return covering.reduce<RunOverlay>((merged, segment) => ({ ...merged, ...segment.overlay }), {});
}

export interface PaperGrepStyleApplication {
  paragraphs: PaperRichParagraph[];
  /** Styled span count per enabled rule, in application order (rules first, then the nested sequence). */
  styledSpanCounts: Array<{ label: string; spans: number }>;
  /** Enabled rules whose pattern failed validation; they were skipped and are reported honestly. */
  skippedRules: Array<{ name: string; reason: PaperGrepPatternInvalidReason }>;
}

function applyOverlay(run: PaperTextRun, overlay: RunOverlay): PaperTextRun {
  const styled: PaperTextRun = { ...run };
  const target = styled as unknown as Record<RunStyleKey, unknown>;
  for (const key of RUN_STYLE_KEYS) {
    const value = overlay[key];
    if (value !== undefined) target[key] = value;
  }
  return styled;
}

function splitRunAt(run: PaperTextRun, offsets: readonly number[], textStart: number): PaperTextRun[] {
  const pieces: PaperTextRun[] = [];
  let cursor = textStart;
  let rest = run.text;
  for (const offset of offsets) {
    const cut = offset - cursor;
    if (cut <= 0 || cut >= rest.length) continue;
    pieces.push({ ...run, text: rest.slice(0, cut) });
    rest = rest.slice(cut);
    cursor += cut;
  }
  pieces.push({ ...run, text: rest });
  return pieces;
}

/**
 * Apply the document's nested-style sequence (from each paragraph's start) and then every enabled
 * GREP rule (in order; later rules override earlier ones on overlap) to one rich-text frame.
 * Pure: input is never mutated; text content is preserved exactly, runs are only split and
 * restyled. Frames without rich text return unchanged.
 */
export function applyPaperGrepStylesToRichText(
  paragraphs: PaperRichParagraph[] | undefined,
  styles: PaperStyleCatalogs,
): PaperGrepStyleApplication {
  const result: PaperGrepStyleApplication = { paragraphs: paragraphs ?? [], styledSpanCounts: [], skippedRules: [] };
  if (!paragraphs || paragraphs.length === 0) return result;

  const rules = (styles.grepStyleRules ?? [])
    .filter((rule) => rule.enabled !== false)
    .slice(0, PAPER_GREP_STYLE_LIMITS.maxRuleCount);
  const steps = (styles.nestedStyleSteps ?? [])
    .filter((step) => step.enabled !== false)
    .slice(0, PAPER_GREP_STYLE_LIMITS.maxNestedStepCount);

  const overlays = new Map<string, RunOverlay>();
  for (const id of new Set([...rules.map((rule) => rule.characterStyleId), ...steps.map((step) => step.characterStyleId)])) {
    const overlay = runOverlayForStyle(styles, id);
    if (overlay) overlays.set(id, overlay);
  }

  const ruleCounts = new Map<string, number>();
  for (const rule of rules) {
    const validation = validatePaperGrepPattern(rule.pattern);
    if (validation.ok) ruleCounts.set(rule.id, 0);
    else result.skippedRules.push({ name: rule.name || rule.id, reason: validation.reason });
  }

  const validNestedSteps: PaperNestedStyleStep[] = [];
  for (const step of steps) {
    if (step.delimiterPattern !== '') {
      const validation = validatePaperGrepPattern(step.delimiterPattern);
      if (!validation.ok) {
        result.skippedRules.push({ name: step.id, reason: validation.reason });
        break;
      }
    }
    validNestedSteps.push(step);
  }

  let nestedStyledParagraphs = 0;
  const output: PaperRichParagraph[] = [];
  for (const paragraph of paragraphs) {
    const text = paragraph.runs.map((run) => run.text).join('');
    const nested = nestedSegments(text, validNestedSteps, overlays);
    const grep = grepSegments(text, rules, overlays, nested.length);
    for (const segment of grep) {
      ruleCounts.set(segment.ownerRuleId, (ruleCounts.get(segment.ownerRuleId) ?? 0) + 1);
    }
    const segments = [...nested, ...grep];
    if (nested.length > 0) nestedStyledParagraphs += 1;
    if (segments.length === 0) {
      output.push(paragraph);
      continue;
    }

    // Cut points at every segment boundary so each surviving run piece has one winning overlay.
    const cuts = new Set<number>();
    for (const segment of segments) {
      if (segment.start > 0 && segment.start < text.length) cuts.add(segment.start);
      if (segment.end > 0 && segment.end < text.length) cuts.add(segment.end);
    }
    const sortedCuts = [...cuts].sort((left, right) => left - right);

    const runs: PaperTextRun[] = [];
    let cursor = 0;
    for (const run of paragraph.runs) {
      const runCuts = sortedCuts.filter((cut) => cut > cursor && cut < cursor + run.text.length);
      for (const piece of splitRunAt(run, runCuts, cursor)) {
        const overlay = overlayAt(segments, cursor);
        runs.push(overlay ? applyOverlay(piece, overlay) : piece);
        cursor += piece.text.length;
      }
    }
    output.push({ ...paragraph, runs });
  }

  result.paragraphs = output;
  result.styledSpanCounts = [
    ...rules
      .filter((rule) => ruleCounts.has(rule.id))
      .map((rule) => ({ label: rule.name || rule.id, spans: ruleCounts.get(rule.id) ?? 0 })),
    ...(nestedStyledParagraphs > 0 ? [{ label: 'nested-style', spans: nestedStyledParagraphs }] : []),
  ];
  return result;
}

/** Sanitize persisted/edited rule arrays. Invalid entries are dropped, never invented. */
export function normalizePaperGrepStyleRules(value: unknown): PaperGrepStyleRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is PaperGrepStyleRule => Boolean(entry) && typeof entry === 'object'
      && typeof (entry as PaperGrepStyleRule).id === 'string'
      && typeof (entry as PaperGrepStyleRule).characterStyleId === 'string')
    .slice(0, PAPER_GREP_STYLE_LIMITS.maxRuleCount)
    .map((rule) => ({
      id: rule.id,
      name: String(rule.name ?? '').slice(0, PAPER_GREP_STYLE_LIMITS.maxRuleNameLength),
      enabled: rule.enabled !== false,
      pattern: String(rule.pattern ?? '').slice(0, PAPER_GREP_STYLE_LIMITS.maxPatternLength),
      caseInsensitive: rule.caseInsensitive === true,
      characterStyleId: rule.characterStyleId,
    }));
}

export function normalizePaperNestedStyleSteps(value: unknown): PaperNestedStyleStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is PaperNestedStyleStep => Boolean(entry) && typeof entry === 'object'
      && typeof (entry as PaperNestedStyleStep).id === 'string'
      && typeof (entry as PaperNestedStyleStep).characterStyleId === 'string')
    .slice(0, PAPER_GREP_STYLE_LIMITS.maxNestedStepCount)
    .map((step) => ({
      id: step.id,
      enabled: step.enabled !== false,
      characterStyleId: step.characterStyleId,
      delimiterPattern: String(step.delimiterPattern ?? '').slice(0, PAPER_GREP_STYLE_LIMITS.maxPatternLength),
      repeat: Number.isFinite(step.repeat)
        ? Math.min(PAPER_GREP_STYLE_LIMITS.maxRepeat, Math.max(1, Math.round(step.repeat)))
        : 1,
      inclusive: step.inclusive === true,
    }));
}
