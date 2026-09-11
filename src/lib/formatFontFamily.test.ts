import { describe, expect, it } from 'vitest';
import { formatFontFamily, formatSingleFontFamily, normalizeFontWeight } from './formatFontFamily';

describe('formatSingleFontFamily', () => {
  it('leaves generic keyword families unquoted', () => {
    expect(formatSingleFontFamily('serif')).toBe('serif');
    expect(formatSingleFontFamily('sans-serif')).toBe('sans-serif');
    expect(formatSingleFontFamily('monospace')).toBe('monospace');
    expect(formatSingleFontFamily('system-ui')).toBe('system-ui');
    expect(formatSingleFontFamily('ui-sans-serif')).toBe('ui-sans-serif');
    expect(formatSingleFontFamily('math')).toBe('math');
  });

  it('leaves simple single-word identifiers unquoted', () => {
    expect(formatSingleFontFamily('Inter')).toBe('Inter');
    expect(formatSingleFontFamily('Impact')).toBe('Impact');
    expect(formatSingleFontFamily('Cormorant_Garamond')).toBe('Cormorant_Garamond');
  });

  it('quotes family names that contain whitespace', () => {
    expect(formatSingleFontFamily('M PLUS 1')).toBe('"M PLUS 1"');
    expect(formatSingleFontFamily('Source Sans 3')).toBe('"Source Sans 3"');
    expect(formatSingleFontFamily('M PLUS Rounded 1c')).toBe('"M PLUS Rounded 1c"');
  });

  it('quotes family names that start with digits or contain punctuation', () => {
    expect(formatSingleFontFamily('Source Serif 4')).toBe('"Source Serif 4"');
    expect(formatSingleFontFamily('19th Century')).toBe('"19th Century"');
  });

  it('escapes embedded quotes and backslashes', () => {
    expect(formatSingleFontFamily('Weird "Quoted" Font')).toBe('"Weird \\"Quoted\\" Font"');
    expect(formatSingleFontFamily('Back\\\\slash')).toBe('"Back\\\\slash"');
  });

  it('trims surrounding whitespace', () => {
    expect(formatSingleFontFamily('  Inter  ')).toBe('Inter');
    expect(formatSingleFontFamily('  Source Sans 3  ')).toBe('"Source Sans 3"');
  });

  it('quotes CSS-wide reserved keywords when used as family names', () => {
    expect(formatSingleFontFamily('inherit')).toBe('"inherit"');
    expect(formatSingleFontFamily('initial')).toBe('"initial"');
    expect(formatSingleFontFamily('unset')).toBe('"unset"');
    expect(formatSingleFontFamily('revert')).toBe('"revert"');
    expect(formatSingleFontFamily('revert-layer')).toBe('"revert-layer"');
  });
});

describe('formatFontFamily', () => {
  it('serializes fallback stacks with per-family quoting', () => {
    expect(formatFontFamily('M PLUS 1, Inter, sans-serif')).toBe('"M PLUS 1", Inter, sans-serif');
    expect(formatFontFamily('Source Sans 3,system-ui,sans-serif')).toBe('"Source Sans 3", system-ui, sans-serif');
  });

  it('serializes the shipped problematic bundled families correctly', () => {
    const cases = [
      { input: 'M PLUS 1', output: '"M PLUS 1"' },
      { input: 'M PLUS 2', output: '"M PLUS 2"' },
      { input: 'M PLUS Rounded 1c', output: '"M PLUS Rounded 1c"' },
      { input: 'Source Sans 3', output: '"Source Sans 3"' },
      { input: 'Source Serif 4', output: '"Source Serif 4"' },
    ];
    for (const { input, output } of cases) {
      expect(formatFontFamily(input)).toBe(output);
    }
  });

  it('preserves already-quoted double and single names without re-quoting', () => {
    expect(formatFontFamily('"M PLUS 1", Inter, sans-serif')).toBe('"M PLUS 1", Inter, sans-serif');
    expect(formatFontFamily("'Source Sans 3', serif")).toBe('"Source Sans 3", serif');
  });

  it('preserves commas inside quoted family names', () => {
    expect(formatFontFamily('"Name, With Comma", serif')).toBe('"Name, With Comma", serif');
    expect(formatFontFamily("'A, B, C', sans-serif")).toBe('"A, B, C", sans-serif');
  });

  it('preserves escapes inside quoted names and normalizes quote style', () => {
    expect(formatFontFamily('"Weird \\"Quoted\\" Font", serif')).toBe('"Weird \\"Quoted\\" Font", serif');
    expect(formatFontFamily("'Back\\\\slash', serif")).toBe('"Back\\\\slash", serif');
  });

  it('handles escaped commas and backslashes in unquoted identifiers', () => {
    expect(formatFontFamily('Foo\\, Bar, serif')).toBe('"Foo, Bar", serif');
  });

  it('skips empty entries safely', () => {
    expect(formatFontFamily('Inter,,sans-serif')).toBe('Inter, sans-serif');
    expect(formatFontFamily(',Inter,,')).toBe('Inter');
    expect(formatFontFamily('  ,  ,  ')).toBe('');
  });

  it('quotes CSS-wide reserved words and preserves generic keywords', () => {
    expect(formatFontFamily('inherit, initial, unset, revert, revert-layer, serif')).toBe(
      '"inherit", "initial", "unset", "revert", "revert-layer", serif',
    );
  });
});

describe('normalizeFontWeight', () => {
  it('clamps numeric weights to the valid CSS range and rounds them', () => {
    expect(normalizeFontWeight(50)).toBe(50);
    expect(normalizeFontWeight(400)).toBe(400);
    expect(normalizeFontWeight(1000)).toBe(1000);
    expect(normalizeFontWeight(1200)).toBe(1000);
    expect(normalizeFontWeight(0)).toBe(1);
    expect(normalizeFontWeight(350.7)).toBe(351);
  });

  it('falls back to 400 for missing or non-numeric weights', () => {
    expect(normalizeFontWeight(undefined)).toBe(400);
    expect(normalizeFontWeight(null)).toBe(400);
    expect(normalizeFontWeight('bold')).toBe(400);
    expect(normalizeFontWeight(Number.NaN)).toBe(400);
    expect(normalizeFontWeight(Number.POSITIVE_INFINITY)).toBe(400);
  });
});


describe('formatFontFamily standards-conscious identity preservation', () => {
  it('preserves quoted generic-looking names instead of promoting them to generics', () => {
    expect(formatFontFamily('"serif", serif')).toBe('"serif", serif');
    expect(formatFontFamily("'sans-serif', sans-serif")).toBe('"sans-serif", sans-serif');
    expect(formatFontFamily('"system-ui"')).toBe('"system-ui"');
  });

  it('preserves meaningful quoted boundary whitespace', () => {
    expect(formatFontFamily('"  M PLUS 1  "')).toBe('"  M PLUS 1  "');
    expect(formatFontFamily('" Leading"')).toBe('" Leading"');
  });

  it('trims only separator whitespace around unquoted names', () => {
    expect(formatFontFamily('  Inter  ,  sans-serif  ')).toBe('Inter, sans-serif');
  });

  it('parses CSS hexadecimal escapes with Chromium terminator semantics', () => {
    // A single following whitespace is always consumed after a hex escape,
    // regardless of how many hex digits were read.
    expect(formatFontFamily('Foo\\2c Bar, serif')).toBe('"Foo,Bar", serif');
    expect(formatFontFamily('Foo\\000020Bar, serif')).toBe('"Foo Bar", serif');
    expect(formatFontFamily('Foo\\000041 Bar, serif')).toBe('FooABar, serif');
    expect(formatFontFamily('Foo\\41 Bar, serif')).toBe('FooABar, serif');
    expect(formatFontFamily('Foo\\1F600 Bar, serif')).toBe('Foo😀Bar, serif');
  });

  it('treats CSS comments as whitespace tokens, not family-name text', () => {
    expect(formatFontFamily('Foo/**/Bar, serif')).toBe('"Foo Bar", serif');
    expect(formatFontFamily('Foo/* comment */Bar, serif')).toBe('"Foo Bar", serif');
    expect(formatFontFamily('Foo /* c1 */ /* c2 */ Bar, serif')).toBe('"Foo Bar", serif');
  });

  it('preserves escaped literal characters in unquoted identifiers', () => {
    expect(formatFontFamily('Foo\\ Bar, serif')).toBe('"Foo Bar", serif');
    expect(formatFontFamily('Foo\\,Bar, serif')).toBe('"Foo,Bar", serif');
  });

  it('treats escaped newlines as line continuations', () => {
    expect(formatFontFamily('Foo\\\nBar, serif')).toBe('FooBar, serif');
    expect(formatFontFamily('Foo\\\r\nBar, serif')).toBe('FooBar, serif');
  });

  it('escapes control characters while preserving identity', () => {
    // NUL is parsed as U+FFFD; the remaining characters form a valid identifier.
    expect(formatFontFamily('Foo\\0 Bar, serif')).toBe('Foo\uFFFD' + 'Bar, serif');
    // DEL and newline stay quoted and are escaped as hex sequences.
    expect(formatFontFamily('Foo\\7f Bar, serif')).toBe('"Foo\\7f Bar", serif');
    expect(formatFontFamily('Foo\\a Bar, serif')).toBe('"Foo\\a Bar", serif');
  });

  it('preserves the quote style of input families while normalizing unsafe content', () => {
    expect(formatFontFamily("'M PLUS 1', serif")).toBe('"M PLUS 1", serif');
    expect(formatFontFamily('"inherit", initial')).toBe('"inherit", "initial"');
  });

  it('does not corrupt already-valid persisted stacks', () => {
    const stacks = [
      'Inter, system-ui, sans-serif',
      '"M PLUS 1", Inter, sans-serif',
      "'Source Sans 3', system-ui, sans-serif",
      '"Name, With Comma", serif',
      '"Weird \\"Quoted\\" Font", monospace',
    ];
    for (const stack of stacks) {
      expect(formatFontFamily(stack)).toBeTruthy();
    }
  });
});
