import { describe, expect, it } from 'vitest';
import {
  createPaperAuthoredNote,
  getPaperAuthoredNotesForPage,
  normalizePaperAuthoredNotes,
  paperAuthoredNoteNumber,
  removePaperAuthoredNote,
  upsertPaperAuthoredNote,
  PAPER_AUTHORED_NOTE_BODY_MAX_LENGTH,
  PAPER_AUTHORED_NOTES_MAX,
} from './paperAuthoredNotes';
import {
  addFrameToPaperPage,
  addPaperPage,
  createDefaultPaperDocument,
  exportPaperDocumentToPrintHtml,
  parsePaperDocument,
  serializePaperDocument,
} from './paperDocument';

describe('Paper authored footnotes and endnotes', () => {
  it('requires a live page/frame and bounded non-empty authored text', () => {
    const document = createDefaultPaperDocument({ title: 'Notes' });
    const pageId = document.pages[0]!.id;
    const withFrame = addFrameToPaperPage(document, pageId, {
      kind: 'text', xMm: 20, yMm: 20, widthMm: 80, heightMm: 20, text: 'Reference',
    }).document;
    const frameId = withFrame.pages[0]!.frames[0]!.id;

    expect(createPaperAuthoredNote(withFrame, { kind: 'footnote', body: 'Note', pageId, frameId, now: 1 })).toMatchObject({
      kind: 'footnote', body: 'Note', pageId, frameId, createdAt: 1,
    });
    expect(createPaperAuthoredNote(withFrame, { kind: 'footnote', body: ' ', pageId })).toBeUndefined();
    expect(createPaperAuthoredNote(withFrame, { kind: 'footnote', body: 'Note', pageId: 'missing' })).toBeUndefined();
    expect(createPaperAuthoredNote(withFrame, { kind: 'footnote', body: 'Note', pageId, frameId: 'missing' })).toBeUndefined();
    expect(createPaperAuthoredNote(withFrame, {
      kind: 'footnote', body: 'x'.repeat(PAPER_AUTHORED_NOTE_BODY_MAX_LENGTH + 1), pageId,
    })).toBeUndefined();
  });

  it('deduplicates, sorts, bounds, and numbers notes deterministically', () => {
    const document = createDefaultPaperDocument();
    const pageId = document.pages[0]!.id;
    const entries = Array.from({ length: PAPER_AUTHORED_NOTES_MAX + 2 }, (_, index) => ({
      id: `note-${index}`,
      kind: 'footnote' as const,
      body: `Body ${index}`,
      pageId,
      createdAt: index + 1,
      updatedAt: index + 1,
    }));
    const normalized = normalizePaperAuthoredNotes([...entries, entries[0]]);
    expect(normalized).toHaveLength(PAPER_AUTHORED_NOTES_MAX);
    expect(normalized[0]!.id).toBe('note-0');
    expect(normalized.at(-1)!.id).toBe(`note-${PAPER_AUTHORED_NOTES_MAX - 1}`);
    expect(paperAuthoredNoteNumber({ ...document, authoredNotes: normalized }, normalized[4]!)).toBe(5);
    expect(getPaperAuthoredNotesForPage({ ...document, authoredNotes: normalized }, pageId, 'endnote')).toEqual([]);
  });

  it('upserts without losing creation time and removes only an existing note', () => {
    const document = createDefaultPaperDocument();
    const pageId = document.pages[0]!.id;
    const first = upsertPaperAuthoredNote(document, { kind: 'endnote', body: 'First', pageId, id: 'n1', now: 10 });
    const updated = upsertPaperAuthoredNote(first, { kind: 'endnote', body: 'Updated', pageId, id: 'n1', now: 20 });
    expect(updated.authoredNotes).toEqual([expect.objectContaining({ id: 'n1', body: 'Updated', createdAt: 10, updatedAt: 20 })]);
    expect(removePaperAuthoredNote(updated, 'missing')).toBe(updated);
    expect(removePaperAuthoredNote(updated, 'n1').authoredNotes).toEqual([]);
  });

  it('survives Paper save/reopen and prints page footnotes plus document-end endnotes', () => {
    const first = createDefaultPaperDocument({ title: 'Print notes' });
    const pageId = first.pages[0]!.id;
    const second = addPaperPage(first);
    const endPageId = second.pages[1]!.id;
    const withNotes = upsertPaperAuthoredNote(
      upsertPaperAuthoredNote(second, { kind: 'footnote', body: 'Footnote <safe>', pageId, now: 1 }),
      { kind: 'endnote', body: 'Endnote & safe', pageId, now: 2 },
    );
    const reopened = parsePaperDocument(serializePaperDocument(withNotes));
    expect(reopened.authoredNotes).toEqual(withNotes.authoredNotes);
    const html = exportPaperDocumentToPrintHtml(reopened, { includeProductionMarks: false });
    expect(html).toContain('data-paper-note-kind="footnote"');
    expect(html).toContain('Footnote &lt;safe&gt;');
    expect(html).toContain('data-paper-note-kind="endnote"');
    expect(html).toContain('Endnote &amp; safe');
    expect(html).toContain(`data-page="${reopened.pages[1]!.pageNumber}"`);
    expect(endPageId).toBe(reopened.pages[1]!.id);
  });
});
