/**
 * Shared CSS `<family-name>` serializer.
 *
 * Canvas and CSS `font` shorthands reject unquoted family names that contain
 * whitespace, digits, or most punctuation (e.g. `M PLUS 1`, `Source Sans 3`).
 * Generic keyword families (`sans-serif`, `system-ui`, …) must stay unquoted so
 * the browser can resolve them. This helper quotes/escapes every non-generic
 * name and is safe for both single names and comma-separated fallback stacks.
 *
 * The parser is standards-conscious about family *identity*: it preserves the
 * distinction between quoted and unquoted names, preserves whitespace inside
 * quoted strings, treats CSS comments as whitespace, and handles CSS escapes
 * (hex, literal, and line continuations) with the same terminator semantics as
 * Chromium.
 */

const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);

/**
 * CSS-wide keywords that are invalid as unquoted `<family-name>` values. They
 * must be quoted when used as actual font family names.
 */
const CSS_WIDE_KEYWORDS = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

const MIN_FONT_WEIGHT = 1;
const MAX_FONT_WEIGHT = 1000;
const DEFAULT_FONT_WEIGHT = 400;

type QuoteChar = '"' | "'";

interface ParsedFamily {
  /** Unescaped family identity. */
  raw: string;
  /** The original quote character, or `null` if the name was unquoted. */
  quoted: QuoteChar | null;
}

function isGenericFontFamily(name: string): boolean {
  return GENERIC_FONT_FAMILIES.has(name.toLowerCase());
}

function isCssWideKeyword(name: string): boolean {
  return CSS_WIDE_KEYWORDS.has(name.toLowerCase());
}

function isIdentStartCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x41 && codePoint <= 0x5a) || // A-Z
    (codePoint >= 0x61 && codePoint <= 0x7a) || // a-z
    codePoint === 0x5f || // _
    codePoint >= 0x80 // non-ASCII
  );
}

function isIdentCodePoint(codePoint: number): boolean {
  return (
    isIdentStartCodePoint(codePoint) ||
    (codePoint >= 0x30 && codePoint <= 0x39) || // 0-9
    codePoint === 0x2d // -
  );
}

function isUnquotedIdentifier(name: string): boolean {
  if (name.length === 0) {
    return false;
  }

  const first = name.codePointAt(0) ?? 0;
  // Identifiers may not start with a digit, nor with a hyphen followed by a digit.
  if (first >= 0x30 && first <= 0x39) {
    return false;
  }
  if (first === 0x2d && name.length > 1) {
    const second = name.charCodeAt(1);
    if (second >= 0x30 && second <= 0x39) {
      return false;
    }
  }

  for (let index = 0; index < name.length; index += 1) {
    const codePoint = name.codePointAt(index) ?? 0;
    if (!isIdentCodePoint(codePoint)) {
      return false;
    }
    if (codePoint > 0xffff) {
      index += 1; // surrogate pair already consumed by codePointAt
    }
  }

  return true;
}

function codePointToChar(codePoint: number): string {
  if (codePoint === 0 || codePoint > 0x10ffff) {
    return '\uFFFD';
  }
  return String.fromCodePoint(codePoint);
}

function codePointToHexEscape(codePoint: number): string {
  const hex = codePoint.toString(16).toLowerCase();
  return `\\${hex} `;
}

function escapeDoubleQuotedName(name: string): string {
  let result = '';
  for (let index = 0; index < name.length; index += 1) {
    const codePoint = name.codePointAt(index) ?? 0;
    if (codePoint > 0xffff) {
      index += 1;
    }

    if (codePoint === 0x5c) {
      // backslash
      result += '\\\\';
    } else if (codePoint === 0x22) {
      // double quote
      result += '\\"';
    } else if (
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      codePoint === 0x80 || // U+0080 is a valid identifier start but still escaped for clarity
      false
    ) {
      // C0 controls and DEL are escaped as hex sequences with an explicit terminator.
      result += codePointToHexEscape(codePoint);
    } else {
      result += String.fromCodePoint(codePoint);
    }
  }
  return result;
}

/**
 * Skip a CSS comment that starts at `index` (the `/` has already been seen).
 * Returns the index of the first character after the closing comment delimiter,
 * or `length` if the comment is unclosed.
 */
function skipCssComment(stack: string, index: number): number {
  const length = stack.length;
  // index currently points at '*'; confirm it is the start of a comment.
  if (stack[index] !== '*') {
    return index;
  }
  let cursor = index + 1;
  while (cursor < length - 1) {
    if (stack[cursor] === '*' && stack[cursor + 1] === '/') {
      return cursor + 2;
    }
    cursor += 1;
  }
  return length;
}

/**
 * Consume a CSS escape sequence that starts at `index` (the backslash has
 * already been read). Returns the decoded character and the next index.
 */
function consumeCssEscape(stack: string, index: number): { char: string; nextIndex: number } {
  const length = stack.length;
  if (index >= length) {
    return { char: '\\', nextIndex: index };
  }

  const first = stack[index];

  // Hexadecimal escape: 1–6 hex digits. A single following whitespace is
  // consumed as a terminator whenever it is present, matching Chromium and the
  // CSS Syntax specification.
  if (/^[0-9a-fA-F]$/.test(first)) {
    let hex = first;
    let next = index + 1;
    while (next < length && /^[0-9a-fA-F]$/.test(stack[next]) && hex.length < 6) {
      hex += stack[next];
      next += 1;
    }
    if (next < length && (stack[next] === ' ' || stack[next] === '\t')) {
      next += 1;
    }
    return { char: codePointToChar(parseInt(hex, 16)), nextIndex: next };
  }

  // Line continuation: backslash followed by a newline is removed entirely.
  if (first === '\n') {
    return { char: '', nextIndex: index + 1 };
  }
  if (first === '\r') {
    const afterCr = index + 1;
    if (afterCr < length && stack[afterCr] === '\n') {
      return { char: '', nextIndex: afterCr + 1 };
    }
    return { char: '', nextIndex: afterCr };
  }

  // Literal escape: include the next character unchanged.
  return { char: first, nextIndex: index + 1 };
}

/**
 * Parse a comma-separated CSS font-family stack into individual family records.
 * Handles double-quoted and single-quoted strings, escaped characters,
 * commas inside quotes, CSS comments, and empty entries.
 */
function parseFontFamilyStack(stack: string): ParsedFamily[] {
  const families: ParsedFamily[] = [];
  let index = 0;
  const length = stack.length;

  function skipWhitespaceAndComments(): void {
    while (index < length) {
      if (/\s/.test(stack[index])) {
        index += 1;
        continue;
      }
      if (stack[index] === '/' && index + 1 < length && stack[index + 1] === '*') {
        index = skipCssComment(stack, index + 1);
        continue;
      }
      break;
    }
  }

  while (index < length) {
    skipWhitespaceAndComments();
    if (index >= length) {
      break;
    }
    if (stack[index] === ',') {
      index += 1;
      continue;
    }

    let raw = '';
    let quoted: QuoteChar | null = null;

    if (stack[index] === '"' || stack[index] === "'") {
      quoted = stack[index] as QuoteChar;
      index += 1;
      while (index < length) {
        const char = stack[index];
        if (char === '\\') {
          const escaped = consumeCssEscape(stack, index + 1);
          raw += escaped.char;
          index = escaped.nextIndex;
          continue;
        }
        if (char === quoted) {
          index += 1;
          break;
        }
        raw += char;
        index += 1;
      }
    } else {
      while (index < length) {
        const char = stack[index];
        if (char === '\\') {
          const escaped = consumeCssEscape(stack, index + 1);
          raw += escaped.char;
          index = escaped.nextIndex;
          continue;
        }
        if (char === ',') {
          break;
        }
        if (char === '/' && index + 1 < length && stack[index + 1] === '*') {
          // A CSS comment inside an unquoted name acts as whitespace: it
          // separates identifiers that still belong to the same family name.
          if (raw.length > 0 && !raw.endsWith(' ')) {
            raw += ' ';
          }
          index = skipCssComment(stack, index + 1);
          continue;
        }
        if (/\s/.test(char)) {
          // Collapse runs of whitespace (and comments) to a single separator.
          if (raw.length > 0 && !raw.endsWith(' ')) {
            raw += ' ';
          }
          index += 1;
          continue;
        }
        raw += char;
        index += 1;
      }
      raw = raw.trim();
    }

    if (raw.length > 0) {
      families.push({ raw, quoted });
    }

    if (index < length && stack[index] === ',') {
      index += 1;
    }
  }

  return families;
}

function serializeFamilyName(family: ParsedFamily): string {
  if (family.quoted) {
    // Preserve the quoted status but normalize to double quotes for output. This
    // keeps quoted generic-looking names (e.g. "serif") distinct from the
    // unquoted generic keyword while producing a single canonical serialization.
    const escaped = escapeDoubleQuotedName(family.raw);
    return `"${escaped}"`;
  }

  // Unquoted names: keep generic keywords generic, quote wide keywords and any
  // name that is not a valid CSS identifier.
  if (isGenericFontFamily(family.raw)) {
    return family.raw;
  }
  if (isCssWideKeyword(family.raw) || !isUnquotedIdentifier(family.raw)) {
    return `"${escapeDoubleQuotedName(family.raw)}"`;
  }
  return family.raw;
}

export function formatSingleFontFamily(name: string): string {
  const parsed = parseFontFamilyStack(name);
  const first = parsed[0];
  if (!first) {
    return '""';
  }
  return serializeFamilyName(first);
}

export function formatFontFamily(stack: string): string {
  return parseFontFamilyStack(stack)
    .map((family) => serializeFamilyName(family))
    .join(', ');
}

/**
 * Clamp a persisted or user-supplied font weight to the valid CSS numeric
 * range (`1`–`1000`). Non-numeric or out-of-range values fall back to `400`.
 */
export function normalizeFontWeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_FONT_WEIGHT;
  }
  return Math.max(MIN_FONT_WEIGHT, Math.min(MAX_FONT_WEIGHT, Math.round(value)));
}
