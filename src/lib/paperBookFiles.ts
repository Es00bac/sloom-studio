import type { PaperDocument, PaperStyleCatalogs } from '../types/paper';
import { exportPaperDocumentToPrintHtml } from './paperDocument';

export const PAPER_BOOK_MAX_CHAPTERS = 200;
export const PAPER_BOOK_TITLE_MAX_LENGTH = 200;
export const PAPER_BOOK_CHAPTER_TITLE_MAX_LENGTH = 200;

export interface PaperBookChapter {
  id: string;
  documentId: string;
  title: string;
  order: number;
}

export interface PaperBookFile {
  id: string;
  title: string;
  chapters: PaperBookChapter[];
  /** When enabled, the first available chapter is the style authority for the composed book. */
  synchronizeStyles: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PaperBookChapterPageRange {
  chapterId: string;
  documentId: string;
  title: string;
  startPage: number;
  endPage: number;
  pageCount: number;
}

export interface PaperBookComposition {
  book: PaperBookFile;
  documents: Record<string, PaperDocument>;
  pageRanges: PaperBookChapterPageRange[];
}

export interface PaperBookDraft {
  id?: string;
  title: string;
  chapters: Array<Partial<PaperBookChapter> & Pick<PaperBookChapter, 'documentId'>>;
  synchronizeStyles?: boolean;
  now?: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function cleanId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return id.length > 0 && id.length <= 160 ? id : undefined;
}

function cleanText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/[\r\n]+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, maxLength) : fallback;
}

function bookId(now: number): string {
  return `paper-book-${globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.floor(Math.random() * 100000)}`}`;
}

function chapterId(now: number, index: number): string {
  return `paper-book-chapter-${now}-${index}`;
}

function normalizeChapter(value: unknown, index: number): PaperBookChapter | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const documentId = cleanId(record.documentId);
  if (!documentId) return undefined;
  const id = cleanId(record.id) ?? chapterId(0, index);
  return {
    id,
    documentId,
    title: cleanText(record.title, PAPER_BOOK_CHAPTER_TITLE_MAX_LENGTH, `Chapter ${index + 1}`),
    order: finite(record.order) ? record.order : index,
  };
}

export function normalizePaperBookFile(value: unknown): PaperBookFile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = cleanId(record.id);
  if (!id) return undefined;
  const rawChapters = Array.isArray(record.chapters) ? record.chapters : [];
  const seenChapterIds = new Set<string>();
  const seenDocumentIds = new Set<string>();
  const chapters = rawChapters
    .map((chapter, index) => normalizeChapter(chapter, index))
    .filter((chapter): chapter is PaperBookChapter => {
      if (!chapter || seenChapterIds.has(chapter.id) || seenDocumentIds.has(chapter.documentId)) return false;
      seenChapterIds.add(chapter.id);
      seenDocumentIds.add(chapter.documentId);
      return true;
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .slice(0, PAPER_BOOK_MAX_CHAPTERS)
    .map((chapter, index) => ({ ...chapter, order: index }));
  const createdAt = finite(record.createdAt) ? record.createdAt : 0;
  const updatedAt = finite(record.updatedAt) ? record.updatedAt : createdAt;
  return {
    id,
    title: cleanText(record.title, PAPER_BOOK_TITLE_MAX_LENGTH, 'Untitled Book'),
    chapters,
    synchronizeStyles: record.synchronizeStyles === true,
    createdAt,
    updatedAt,
  };
}

export function createPaperBookFile(
  documents: Record<string, PaperDocument>,
  draft: PaperBookDraft,
): PaperBookFile | undefined {
  const now = finite(draft.now) ? draft.now : Date.now();
  const candidates = draft.chapters.filter((chapter) => Boolean(documents[chapter.documentId]));
  const normalized = normalizePaperBookFile({
    id: cleanId(draft.id) ?? bookId(now),
    title: draft.title,
    chapters: candidates.map((chapter, index) => ({
      id: chapter.id ?? chapterId(now, index),
      documentId: chapter.documentId,
      title: chapter.title,
      order: chapter.order ?? index,
    })),
    synchronizeStyles: draft.synchronizeStyles === true,
    createdAt: now,
    updatedAt: now,
  });
  return normalized;
}

export function addPaperBookChapter(
  book: PaperBookFile,
  documents: Record<string, PaperDocument>,
  chapter: Omit<PaperBookChapter, 'order'> & { order?: number },
  now = Date.now(),
): PaperBookFile {
  if (!documents[chapter.documentId]) return book;
  if (book.chapters.some((candidate) => candidate.documentId === chapter.documentId)) return book;
  const next = normalizePaperBookFile({
    ...book,
    updatedAt: now,
    chapters: [...book.chapters, { ...chapter, order: chapter.order ?? book.chapters.length }],
  });
  return next ?? book;
}

export function removePaperBookChapter(book: PaperBookFile, chapterIdToRemove: string, now = Date.now()): PaperBookFile {
  if (!book.chapters.some((chapter) => chapter.id === chapterIdToRemove)) return book;
  return {
    ...book,
    chapters: book.chapters
      .filter((chapter) => chapter.id !== chapterIdToRemove)
      .map((chapter, index) => ({ ...chapter, order: index })),
    updatedAt: now,
  };
}

export function projectPaperBook(
  book: PaperBookFile,
  documents: Record<string, PaperDocument>,
): PaperBookComposition {
  const normalized = normalizePaperBookFile(book) ?? { ...book, chapters: [] };
  const retainedDocuments: Record<string, PaperDocument> = {};
  const pageRanges: PaperBookChapterPageRange[] = [];
  let nextPage = 1;
  let styleAuthority: PaperStyleCatalogs | undefined;

  for (const chapter of normalized.chapters) {
    const source = documents[chapter.documentId];
    if (!source) continue;
    const document = normalized.synchronizeStyles && styleAuthority
      ? { ...source, styles: styleAuthority }
      : source;
    if (!styleAuthority) styleAuthority = document.styles;
    const pageCount = document.pages.length;
    retainedDocuments[chapter.documentId] = {
      ...document,
      pages: document.pages.map((page, index) => ({ ...page, pageNumber: nextPage + index })),
    };
    pageRanges.push({
      chapterId: chapter.id,
      documentId: chapter.documentId,
      title: chapter.title,
      startPage: nextPage,
      endPage: nextPage + Math.max(0, pageCount - 1),
      pageCount,
    });
    nextPage += pageCount;
  }

  return { book: normalized, documents: retainedDocuments, pageRanges };
}

export function exportPaperBookToPrintHtml(
  book: PaperBookFile,
  documents: Record<string, PaperDocument>,
): string {
  const composition = projectPaperBook(book, documents);
  const chapters = composition.pageRanges.map((range) => {
    const document = composition.documents[range.documentId];
    if (!document) return '';
    const html = exportPaperDocumentToPrintHtml(document);
    return `<article class="paper-book-chapter" data-paper-book-chapter="${escapeHtml(range.chapterId)}" data-document-id="${escapeHtml(range.documentId)}" data-start-page="${range.startPage}" data-end-page="${range.endPage}"><h1>${escapeHtml(range.title)}</h1>${html}</article>`;
  }).join('\n');
  return `<main class="paper-book" data-paper-book-id="${escapeHtml(composition.book.id)}" data-paper-book-title="${escapeHtml(composition.book.title)}" data-paper-book-page-count="${composition.pageRanges.reduce((sum, range) => sum + range.pageCount, 0)}">${chapters}</main>`;
}

export function serializePaperBookFile(book: PaperBookFile): string {
  const normalized = normalizePaperBookFile(book);
  if (!normalized) throw new Error('Cannot serialize an invalid Paper book file.');
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function parsePaperBookFile(json: string): PaperBookFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The selected file is not a valid Paper book file.');
  }
  const book = normalizePaperBookFile(parsed);
  if (!book) throw new Error('The selected file is not a valid Paper book file.');
  return book;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
