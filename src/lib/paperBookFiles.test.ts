import { describe, expect, it } from 'vitest';
import {
  addPaperBookChapter,
  createPaperBookFile,
  exportPaperBookToPrintHtml,
  normalizePaperBookFile,
  parsePaperBookFile,
  projectPaperBook,
  removePaperBookChapter,
  serializePaperBookFile,
} from './paperBookFiles';
import { addFrameToPaperPage, addPaperPage, createDefaultPaperDocument } from './paperDocument';

function documents() {
  const first = createDefaultPaperDocument({ title: 'First chapter' });
  const second = addPaperPage(createDefaultPaperDocument({ title: 'Second chapter' }));
  return { first: first, second };
}

describe('Paper book files', () => {
  it('creates a bounded ordered chapter model from available documents only', () => {
    const source = documents();
    const book = createPaperBookFile(source, {
      title: '  My <Book>  ',
      chapters: [
        { documentId: 'second', title: 'Second', order: 2 },
        { documentId: 'missing', title: 'Ignored' },
        { documentId: 'first', title: 'First', order: 1 },
        { documentId: 'first', title: 'Duplicate' },
      ],
      now: 100,
    });
    expect(book).toMatchObject({ title: 'My <Book>', createdAt: 100, updatedAt: 100 });
    expect(book?.chapters.map((chapter) => chapter.documentId)).toEqual(['first', 'second']);
    expect(book?.chapters.map((chapter) => chapter.order)).toEqual([0, 1]);
  });

  it('keeps chapter add/remove operations deterministic and refuses unavailable documents', () => {
    const source = documents();
    const book = createPaperBookFile(source, { title: 'Book', chapters: [{ documentId: 'first' }], now: 1 })!;
    const unchanged = addPaperBookChapter(book, source, { id: 'missing', documentId: 'unknown', title: 'Nope' }, 2);
    expect(unchanged).toBe(book);
    const added = addPaperBookChapter(book, source, { id: 'second-chapter', documentId: 'second', title: 'Chapter Two' }, 2);
    expect(added.chapters.map((chapter) => chapter.documentId)).toEqual(['first', 'second']);
    const removed = removePaperBookChapter(added, 'second-chapter', 3);
    expect(removed.chapters.map((chapter) => chapter.documentId)).toEqual(['first']);
    expect(removed.updatedAt).toBe(3);
  });

  it('projects continuous page ranges and synchronizes style catalogs from the first chapter', () => {
    const source = documents();
    const withFrame = addFrameToPaperPage(source.first, source.first.pages[0]!.id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20, text: 'First',
    }).document;
    const sourceDocuments = { first: withFrame, second: source.second };
    const book = createPaperBookFile(sourceDocuments, {
      title: 'Book',
      chapters: [{ documentId: 'first' }, { documentId: 'second' }],
      synchronizeStyles: true,
      now: 1,
    })!;
    const composition = projectPaperBook(book, sourceDocuments);
    expect(composition.pageRanges).toEqual([
      expect.objectContaining({ documentId: 'first', startPage: 1, endPage: 1, pageCount: 1 }),
      expect.objectContaining({ documentId: 'second', startPage: 2, endPage: 3, pageCount: 2 }),
    ]);
    expect(composition.documents.second?.pages.map((page) => page.pageNumber)).toEqual([2, 3]);
    expect(composition.documents.second?.styles).toEqual(composition.documents.first?.styles);
  });

  it('round-trips persisted books and rejects malformed payloads', () => {
    const source = documents();
    const book = createPaperBookFile(source, { title: 'Persistent book', chapters: [{ documentId: 'first' }], now: 5 })!;
    expect(parsePaperBookFile(serializePaperBookFile(book))).toEqual(book);
    expect(() => parsePaperBookFile('{"id": "book", "chapters": "bad"}')).not.toThrow();
    expect(parsePaperBookFile('{"id": "book", "chapters": "bad"}').chapters).toEqual([]);
    expect(() => parsePaperBookFile('not json')).toThrow(/valid Paper book file/);
  });

  it('composes aggregate print HTML with continuous chapter metadata and escaped titles', () => {
    const source = documents();
    const book = createPaperBookFile(source, {
      title: 'Book "One"',
      chapters: [{ documentId: 'first', title: 'First <chapter>' }, { documentId: 'second', title: 'Second' }],
      now: 1,
    })!;
    const html = exportPaperBookToPrintHtml(book, source);
    expect(html).toContain('data-paper-book-title="Book &quot;One&quot;"');
    expect(html).toContain('data-start-page="1" data-end-page="1"');
    expect(html).toContain('data-start-page="2" data-end-page="3"');
    expect(html).toContain('First &lt;chapter&gt;');
    expect(html).toContain('data-paper-book-page-count="3"');
  });

  it('drops duplicate chapter and document identities when normalizing untrusted records', () => {
    const normalized = normalizePaperBookFile({
      id: 'book', title: 'Book', chapters: [
        { id: 'one', documentId: 'doc', title: 'One', order: 4 },
        { id: 'one', documentId: 'other', title: 'Duplicate id', order: 1 },
        { id: 'two', documentId: 'doc', title: 'Duplicate document', order: 0 },
      ], createdAt: 1, updatedAt: 2,
    });
    expect(normalized?.chapters).toEqual([{ id: 'one', documentId: 'doc', title: 'One', order: 0 }]);
  });
});
