// Pure find/change over Paper text. Operates on plain frame text so it is fully testable and shared by
// the store action and (later) a find/change panel. Builds a safe RegExp from the query.

export interface PaperFindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface PaperFindMatch {
  pageId: string;
  frameId: string;
  index: number;
  length: number;
}

export interface PaperTextFrameRef {
  pageId: string;
  frameId: string;
  text: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildQueryRegExp(query: string, options: PaperFindOptions): RegExp | undefined {
  if (!query) return undefined;
  const body = options.wholeWord ? `\\b${escapeRegExp(query)}\\b` : escapeRegExp(query);
  return new RegExp(body, options.caseSensitive ? 'g' : 'gi');
}

/** All matches of `query` across the given text frames (in frame order). */
export function findPaperMatches(
  frames: PaperTextFrameRef[],
  query: string,
  options: PaperFindOptions = {},
): PaperFindMatch[] {
  const pattern = buildQueryRegExp(query, options);
  if (!pattern) return [];

  const matches: PaperFindMatch[] = [];
  for (const frame of frames) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(frame.text)) !== null) {
      matches.push({ pageId: frame.pageId, frameId: frame.frameId, index: match.index, length: match[0].length });
      if (match[0].length === 0) pattern.lastIndex += 1; // guard against zero-length loops
    }
  }
  return matches;
}

/** Replace every match of `query` with `replacement` in a single text value. */
export function replaceAllInText(text: string, query: string, replacement: string, options: PaperFindOptions = {}): string {
  const pattern = buildQueryRegExp(query, options);
  if (!pattern) return text;
  return text.replace(pattern, () => replacement);
}
