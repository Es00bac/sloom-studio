import { describe, expect, it } from 'vitest';
import type { PaperRichParagraph, PaperStyleCatalogs } from '../types/paper';
import {
  applyPaperGrepStylesToRichText,
  normalizePaperGrepStyleRules,
  normalizePaperNestedStyleSteps,
  PAPER_GREP_STYLE_LIMITS,
  resolvePaperCharacterStyleTypography,
  validatePaperGrepPattern,
} from './paperGrepStyles';
import {
  createDefaultPaperDocument,
  parsePaperDocument,
  serializePaperDocument,
  updatePaperStyleAutomation,
} from './paperDocument';

function styles(overrides: Partial<PaperStyleCatalogs> = {}): PaperStyleCatalogs {
  const base = createDefaultPaperDocument({ title: 'GREP scratch' }).styles;
  return { ...base, ...overrides };
}

function rich(text: string): PaperRichParagraph[] {
  return [{ runs: [{ text }] }];
}

const EMPHASIS = 'char-emphasis';
const WHISPER = 'char-whisper';

describe('pattern validation', () => {
  it('accepts bounded valid patterns and rejects empty, over-long, and invalid sources', () => {
    expect(validatePaperGrepPattern('\\d+')).toEqual({ ok: true });
    expect(validatePaperGrepPattern('')).toEqual({ ok: false, reason: 'empty' });
    expect(validatePaperGrepPattern('a'.repeat(PAPER_GREP_STYLE_LIMITS.maxPatternLength + 1))).toEqual({ ok: false, reason: 'too-long' });
    expect(validatePaperGrepPattern('(unclosed')).toEqual({ ok: false, reason: 'invalid-regex' });
    expect(validatePaperGrepPattern('(a+)+$')).toEqual({ ok: false, reason: 'unsafe-regex' });
  });
});

describe('character style resolution', () => {
  it('resolves basedOn ancestors first and stays cycle-safe', () => {
    const catalog = styles({
      character: [
        { id: 'child', name: 'Child', basedOnId: 'parent', typography: { fontWeight: '900' } },
        { id: 'parent', name: 'Parent', basedOnId: 'grandparent', typography: { color: '#ff0000' } },
        { id: 'grandparent', name: 'Grandparent', typography: { fontSizePt: 9 } },
        { id: 'loop-a', name: 'Loop A', basedOnId: 'loop-b', typography: { underline: false } as never },
        { id: 'loop-b', name: 'Loop B', basedOnId: 'loop-a', typography: {} },
      ],
    });
    expect(resolvePaperCharacterStyleTypography(catalog, 'child')).toEqual({ fontWeight: '900', color: '#ff0000', fontSizePt: 9 });
    expect(resolvePaperCharacterStyleTypography(catalog, 'missing')).toBeUndefined();
    expect(resolvePaperCharacterStyleTypography(catalog, 'loop-a')).toBeDefined();
  });
});

describe('GREP style application', () => {
  it('splits runs at match boundaries and overlays only the defined style keys', () => {
    const application = applyPaperGrepStylesToRichText(rich('Order 4711 shipped'), styles({
      grepStyleRules: [{ id: 'r1', name: 'Numbers', enabled: true, pattern: '\\d+', characterStyleId: EMPHASIS }],
    }));
    expect(application.skippedRules).toEqual([]);
    expect(application.styledSpanCounts).toEqual([{ label: 'Numbers', spans: 1 }]);
    expect(application.paragraphs[0].runs.map((run) => run.text)).toEqual(['Order ', '4711', ' shipped']);
    const [plain, styled, trailing] = application.paragraphs[0].runs;
    expect(styled.fontStyle).toBe('italic');
    expect(styled.fontWeight).toBe('700');
    expect(plain.fontStyle).toBeUndefined();
    expect(trailing.fontStyle).toBeUndefined();
    // Text content is preserved exactly.
    expect(application.paragraphs[0].runs.map((run) => run.text).join('')).toBe('Order 4711 shipped');
  });

  it('splits inside an existing run without losing its authored properties', () => {
    const application = applyPaperGrepStylesToRichText(
      [{ runs: [{ text: 'keep-me-bold', fontWeight: '500', color: '#123456' }] }],
      styles({ grepStyleRules: [{ id: 'r1', name: 'Me', enabled: true, pattern: 'me', caseInsensitive: true, characterStyleId: WHISPER }] }),
    );
    const runs = application.paragraphs[0].runs;
    expect(runs.map((run) => run.text)).toEqual(['keep-', 'me', '-bold']);
    expect(runs[0]).toEqual({ text: 'keep-', fontWeight: '500', color: '#123456' });
    // Whisper defines size/tracking/italic; the authored color survives, the rest overlays.
    expect(runs[1]).toMatchObject({ text: 'me', fontWeight: '500', color: '#123456', fontSizePt: 8, tracking: 80, fontStyle: 'italic' });
  });

  it('lets later rules override earlier ones and reports each rule count', () => {
    const application = applyPaperGrepStylesToRichText(rich('aaa bbb'), styles({
      grepStyleRules: [
        { id: 'r1', name: 'First', enabled: true, pattern: 'a+', characterStyleId: EMPHASIS },
        { id: 'r2', name: 'Second', enabled: true, pattern: '\\w+', characterStyleId: WHISPER },
      ],
    }));
    const runs = application.paragraphs[0].runs;
    // 'aaa' carries both rules; the later Whisper rule wins. The space between stays unstyled.
    expect(runs.filter((run) => run.text.trim()).every((run) => run.fontSizePt === 8)).toBe(true);
    expect(application.styledSpanCounts).toEqual([{ label: 'First', spans: 1 }, { label: 'Second', spans: 2 }]);
  });

  it('merges overlapping style keys while letting later rules win only on conflicts', () => {
    const application = applyPaperGrepStylesToRichText(rich('word'), styles({
      character: [
        { id: 'first', name: 'First', typography: { color: '#ff0000', fontWeight: '700' } },
        { id: 'second', name: 'Second', typography: { color: '#00ff00', fontStyle: 'italic' } },
      ],
      grepStyleRules: [
        { id: 'first-rule', name: 'First', enabled: true, pattern: 'word', characterStyleId: 'first' },
        { id: 'second-rule', name: 'Second', enabled: true, pattern: 'word', characterStyleId: 'second' },
      ],
    }));
    expect(application.paragraphs[0].runs).toEqual([{
      text: 'word',
      color: '#00ff00',
      fontWeight: '700',
      fontStyle: 'italic',
    }]);
  });

  it('rejects catastrophic patterns before matching and reports them as skipped', () => {
    const application = applyPaperGrepStylesToRichText(rich(`${'a'.repeat(80)}!`), styles({
      grepStyleRules: [{ id: 'unsafe', name: 'Unsafe', enabled: true, pattern: '(a+)+$', characterStyleId: EMPHASIS }],
    }));
    expect(application.paragraphs[0].runs).toEqual([{ text: `${'a'.repeat(80)}!` }]);
    expect(application.skippedRules).toEqual([{ name: 'Unsafe', reason: 'unsafe-regex' }]);
  });

  it('keeps supplementary characters together when a Unicode match crosses UTF-16 units', () => {
    const application = applyPaperGrepStylesToRichText(rich('😀'), styles({
      grepStyleRules: [{ id: 'emoji', name: 'Emoji', enabled: true, pattern: '.', characterStyleId: EMPHASIS }],
    }));
    expect(application.paragraphs[0].runs).toHaveLength(1);
    expect(application.paragraphs[0].runs[0].text).toBe('😀');
    expect(application.paragraphs[0].runs[0].fontStyle).toBe('italic');
    expect(Array.from(application.paragraphs[0].runs[0].text)).toEqual(['😀']);
  });

  it('ignores disabled rules and unknown style ids, and reports invalid patterns as skipped', () => {
    const application = applyPaperGrepStylesToRichText(rich('alpha 42'), styles({
      grepStyleRules: [
        { id: 'off', name: 'Off', enabled: false, pattern: 'alpha', characterStyleId: EMPHASIS },
        { id: 'ghost', name: 'Ghost', enabled: true, pattern: 'alpha', characterStyleId: 'missing-style' },
        { id: 'bad', name: 'Bad', enabled: true, pattern: '(oops', characterStyleId: EMPHASIS },
      ],
    }));
    expect(application.paragraphs[0].runs).toHaveLength(1);
    expect(application.skippedRules).toEqual([{ name: 'Bad', reason: 'invalid-regex' }]);
  });

  it('keeps the historical default exactly unchanged and stays deterministic', () => {
    const plain = rich('Order 4711 shipped');
    const untouched = applyPaperGrepStylesToRichText(plain, styles());
    expect(untouched.paragraphs).toEqual(plain);
    const first = applyPaperGrepStylesToRichText(plain, styles({
      grepStyleRules: [{ id: 'r1', name: 'Numbers', enabled: true, pattern: '\\d+', characterStyleId: EMPHASIS }],
    }));
    const second = applyPaperGrepStylesToRichText(plain, styles({
      grepStyleRules: [{ id: 'r1', name: 'Numbers', enabled: true, pattern: '\\d+', characterStyleId: EMPHASIS }],
    }));
    expect(first).toEqual(second);
    // The input paragraphs are never mutated.
    expect(plain[0].runs).toEqual([{ text: 'Order 4711 shipped' }]);
  });

  it('bounds the matcher: a pathological text still terminates at the per-paragraph match cap', () => {
    const text = 'x '.repeat(PAPER_GREP_STYLE_LIMITS.maxMatchesPerParagraph + 200);
    const application = applyPaperGrepStylesToRichText(rich(text), styles({
      grepStyleRules: [{ id: 'r1', name: 'X', enabled: true, pattern: 'x', characterStyleId: EMPHASIS }],
    }));
    expect(application.styledSpanCounts).toEqual([{ label: 'X', spans: PAPER_GREP_STYLE_LIMITS.maxMatchesPerParagraph }]);
    expect(application.paragraphs[0].runs.map((run) => run.text).join('')).toBe(text);
  });
});

describe('nested style application', () => {
  it('consumes the paragraph start through the Nth delimiter, then the next step takes over', () => {
    const application = applyPaperGrepStylesToRichText(rich('One. Two. Three. End'), styles({
      nestedStyleSteps: [
        { id: 'n1', enabled: true, characterStyleId: EMPHASIS, delimiterPattern: '\\.', repeat: 2, inclusive: true },
        { id: 'n2', enabled: true, characterStyleId: WHISPER, delimiterPattern: '\\.', repeat: 1, inclusive: false },
      ],
    }));
    const runs = application.paragraphs[0].runs;
    expect(runs.map((run) => run.text)).toEqual(['One. Two.', ' Three', '. End']);
    expect(runs[0].fontStyle).toBe('italic');
    expect(runs[0].fontWeight).toBe('700');
    expect(runs[1].fontSizePt).toBe(8);
    expect(runs[2].fontStyle).toBeUndefined();
    expect(application.styledSpanCounts.at(-1)).toEqual({ label: 'nested-style', spans: 1 });
  });

  it('styles through the end of the paragraph with an empty delimiter pattern', () => {
    const application = applyPaperGrepStylesToRichText(rich('Lead: everything after this'), styles({
      nestedStyleSteps: [
        { id: 'n1', enabled: true, characterStyleId: EMPHASIS, delimiterPattern: ':', repeat: 1, inclusive: true },
        { id: 'n2', enabled: true, characterStyleId: WHISPER, delimiterPattern: '', repeat: 1, inclusive: true },
      ],
    }));
    const runs = application.paragraphs[0].runs;
    expect(runs.map((run) => run.text)).toEqual(['Lead:', ' everything after this']);
    expect(runs[0].fontStyle).toBe('italic');
    expect(runs[1].fontSizePt).toBe(8);
  });

  it('leaves paragraphs without a delimiter match untouched', () => {
    const application = applyPaperGrepStylesToRichText(rich('no delimiter here'), styles({
      nestedStyleSteps: [{ id: 'n1', enabled: true, characterStyleId: EMPHASIS, delimiterPattern: ';', repeat: 1, inclusive: true }],
    }));
    expect(application.paragraphs[0].runs).toHaveLength(1);
    expect(application.styledSpanCounts).toEqual([]);
  });

  it('reports an invalid delimiter and does not shift later nested steps', () => {
    const application = applyPaperGrepStylesToRichText(rich('Lead: everything after this'), styles({
      nestedStyleSteps: [
        { id: 'broken-step', enabled: true, characterStyleId: EMPHASIS, delimiterPattern: '(broken', repeat: 1, inclusive: true },
        { id: 'later-step', enabled: true, characterStyleId: WHISPER, delimiterPattern: '', repeat: 1, inclusive: true },
      ],
    }));
    expect(application.paragraphs[0].runs).toEqual([{ text: 'Lead: everything after this' }]);
    expect(application.skippedRules).toEqual([{ name: 'broken-step', reason: 'invalid-regex' }]);
    expect(application.styledSpanCounts).toEqual([]);
  });
});

describe('normalization and persistence', () => {
  it('sanitizes rule arrays: drops invalid entries and clamps bounds', () => {
    expect(normalizePaperGrepStyleRules(undefined)).toEqual([]);
    const rules = normalizePaperGrepStyleRules([
      { id: 'ok', name: 'N', enabled: true, pattern: 'a', characterStyleId: EMPHASIS, caseInsensitive: true },
      'garbage' as never,
      { characterStyleId: EMPHASIS } as never,
    ]);
    expect(rules).toEqual([{ id: 'ok', name: 'N', enabled: true, pattern: 'a', caseInsensitive: true, characterStyleId: EMPHASIS }]);
    const steps = normalizePaperNestedStyleSteps([
      { id: 's1', enabled: true, characterStyleId: EMPHASIS, delimiterPattern: '\\.', repeat: 999, inclusive: 'yes' as never },
    ]);
    expect(steps[0].repeat).toBe(PAPER_GREP_STYLE_LIMITS.maxRepeat);
    expect(steps[0].inclusive).toBe(false);
  });

  it('round-trips authored rules through serialize/parse with the document', () => {
    let document = createDefaultPaperDocument({ title: 'GREP persistence' });
    document = updatePaperStyleAutomation(document, {
      grepStyleRules: [{ id: 'r1', name: 'Numbers', enabled: true, pattern: '\\d+', characterStyleId: EMPHASIS }],
      nestedStyleSteps: [{ id: 'n1', enabled: true, characterStyleId: WHISPER, delimiterPattern: '\\s', repeat: 3, inclusive: true }],
    });
    const parsed = parsePaperDocument(serializePaperDocument(document));
    expect(parsed.styles.grepStyleRules).toEqual([{ id: 'r1', name: 'Numbers', enabled: true, pattern: '\\d+', caseInsensitive: false, characterStyleId: EMPHASIS }]);
    expect(parsed.styles.nestedStyleSteps).toEqual([{ id: 'n1', enabled: true, characterStyleId: WHISPER, delimiterPattern: '\\s', repeat: 3, inclusive: true }]);
    // A legacy document without the arrays normalizes to empty, not undefined growth.
    const legacy = parsePaperDocument(serializePaperDocument(createDefaultPaperDocument({ title: 'Legacy' })));
    expect(legacy.styles.grepStyleRules).toEqual([]);
    expect(legacy.styles.nestedStyleSteps).toEqual([]);
  });
});
