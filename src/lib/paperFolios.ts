// Pure folio / page-number marker resolution for Paper text. Replaces the page-number tokens a
// letterer types (typically in a master-page header/footer frame) with the live values at render
// time, so an inherited frame shows each page's own number. Framework-free and fully testable.

import type { PaperRichParagraph, PaperTextRun } from '../types/paper';

/** Tokens recognised in frame text. `{#}` mirrors the common InDesign "current page number" marker. */
const PAGE_TOKEN = /\{page\}|\{#\}/g;
const PAGES_TOKEN = /\{pages\}|\{##\}/g;
const ANY_FOLIO_TOKEN = /\{pages\}|\{##\}|\{page\}|\{#\}/g;

/** Replace page-number tokens in `text` with the current page number and total page count. */
export function resolvePaperFolioText(text: string, pageNumber: number, pageCount: number): string {
  if (!text || (!text.includes('{') )) return text;
  return text
    .replace(PAGES_TOKEN, String(Math.max(0, Math.round(pageCount))))
    .replace(PAGE_TOKEN, String(Math.max(0, Math.round(pageNumber))));
}

function appendOriginalRunRange(output: PaperTextRun[], runs: readonly PaperTextRun[], start: number, end: number): void {
  if (end <= start) return;
  let cursor = 0;
  for (const run of runs) {
    const runStart = cursor;
    const runEnd = runStart + run.text.length;
    cursor = runEnd;
    const from = Math.max(start, runStart);
    const to = Math.min(end, runEnd);
    if (to > from) output.push({ ...run, text: run.text.slice(from - runStart, to - runStart) });
  }
}

function runAtOffset(runs: readonly PaperTextRun[], offset: number): PaperTextRun {
  let cursor = 0;
  for (const run of runs) {
    const end = cursor + run.text.length;
    if (offset < end) return run;
    cursor = end;
  }
  return runs[runs.length - 1] ?? { text: '' };
}

/** Resolve folios inside derived rich content without changing the stored story. Matching happens across the
 * concatenated run source, so `{page}` may be split over any number of styled runs. The replacement inherits
 * the style at the token's first source character; text outside tokens keeps its exact run styling. */
export function resolvePaperRichTextFolios<T extends PaperRichParagraph>(
  paragraphs: readonly T[] | undefined,
  pageNumber: number,
  pageCount: number,
): T[] | undefined {
  if (!paragraphs) return undefined;
  const resolvedPage = String(Math.max(0, Math.round(pageNumber)));
  const resolvedPages = String(Math.max(0, Math.round(pageCount)));

  return paragraphs.map((paragraph) => {
    const source = paragraph.runs.map((run) => run.text).join('');
    const matches = [...source.matchAll(ANY_FOLIO_TOKEN)];
    const listMarker = paragraph.listMarker
      ? resolvePaperFolioText(paragraph.listMarker, pageNumber, pageCount)
      : paragraph.listMarker;
    if (matches.length === 0) {
      return { ...paragraph, ...(listMarker !== undefined ? { listMarker } : {}), runs: paragraph.runs.map((run) => ({ ...run })) };
    }

    const runs: PaperTextRun[] = [];
    let cursor = 0;
    for (const match of matches) {
      const start = match.index;
      const token = match[0];
      appendOriginalRunRange(runs, paragraph.runs, cursor, start);
      const style = runAtOffset(paragraph.runs, start);
      const replacement = token === '{pages}' || token === '{##}' ? resolvedPages : resolvedPage;
      runs.push({ ...style, text: replacement });
      cursor = start + token.length;
    }
    appendOriginalRunRange(runs, paragraph.runs, cursor, source.length);
    return { ...paragraph, ...(listMarker !== undefined ? { listMarker } : {}), runs };
  });
}

/** Whether the text carries any folio token (used to flag dynamic frames / skip needless work). */
export function hasPaperFolioToken(text: string | undefined): boolean {
  if (!text) return false;
  PAGE_TOKEN.lastIndex = 0;
  PAGES_TOKEN.lastIndex = 0;
  return PAGE_TOKEN.test(text) || PAGES_TOKEN.test(text);
}
