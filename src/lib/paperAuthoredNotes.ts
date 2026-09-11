import type { PaperAuthoredNote, PaperDocument } from '../types/paper';

/** Bounded authored footnote/endnote model for Paper (MH-067). */
export const PAPER_AUTHORED_NOTES_MAX = 500;
export const PAPER_AUTHORED_NOTE_BODY_MAX_LENGTH = 4_000;

export interface PaperAuthoredNoteDraft {
  kind: PaperAuthoredNote['kind'];
  body: string;
  pageId: string;
  frameId?: string;
  id?: string;
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

function cleanBody(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const body = value.replace(/\r\n?/g, '\n').trim();
  return body.length > 0 && body.length <= PAPER_AUTHORED_NOTE_BODY_MAX_LENGTH ? body : undefined;
}

function idForNote(now: number): string {
  return `paper-note-${globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.floor(Math.random() * 100000)}`}`;
}

function noteFromUnknown(value: unknown): PaperAuthoredNote | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = cleanId(record.id);
  const kind = record.kind === 'footnote' || record.kind === 'endnote' ? record.kind : undefined;
  const body = cleanBody(record.body);
  const pageId = cleanId(record.pageId);
  if (!id || !kind || !body || !pageId || !finite(record.createdAt) || !finite(record.updatedAt)) return undefined;
  const frameId = cleanId(record.frameId);
  return {
    id,
    kind,
    body,
    pageId,
    ...(frameId ? { frameId } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Sanitize persisted notes, discard malformed records, deduplicate IDs, and apply a hard bound. */
export function normalizePaperAuthoredNotes(value: unknown): PaperAuthoredNote[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const notes: PaperAuthoredNote[] = [];
  for (const entry of value) {
    const note = noteFromUnknown(entry);
    if (!note || seen.has(note.id)) continue;
    seen.add(note.id);
    notes.push(note);
  }
  return notes
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .slice(0, PAPER_AUTHORED_NOTES_MAX);
}

/** Create a note only when its page and optional frame are still present in the document. */
export function createPaperAuthoredNote(
  document: PaperDocument,
  draft: PaperAuthoredNoteDraft,
): PaperAuthoredNote | undefined {
  const page = document.pages.find((candidate) => candidate.id === draft.pageId);
  if (!page) return undefined;
  if (draft.frameId && !page.frames.some((frame) => frame.id === draft.frameId)) return undefined;
  const body = cleanBody(draft.body);
  if (!body || (draft.kind !== 'footnote' && draft.kind !== 'endnote')) return undefined;
  const now = finite(draft.now) ? draft.now : Date.now();
  return {
    id: cleanId(draft.id) ?? idForNote(now),
    kind: draft.kind,
    body,
    pageId: page.id,
    ...(draft.frameId ? { frameId: draft.frameId } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertPaperAuthoredNote(
  document: PaperDocument,
  draft: PaperAuthoredNoteDraft,
): PaperDocument {
  const note = createPaperAuthoredNote(document, draft);
  if (!note) return document;
  const existing = (document.authoredNotes ?? []).find((candidate) => candidate.id === note.id);
  const persistedNote = existing
    ? { ...note, createdAt: existing.createdAt }
    : note;
  const notes = normalizePaperAuthoredNotes([
    ...(document.authoredNotes ?? []).filter((candidate) => candidate.id !== persistedNote.id),
    persistedNote,
  ]);
  return { ...document, authoredNotes: notes, updatedAt: persistedNote.updatedAt };
}

export function removePaperAuthoredNote(document: PaperDocument, noteId: string): PaperDocument {
  const notes = (document.authoredNotes ?? []).filter((note) => note.id !== noteId);
  return notes.length === (document.authoredNotes ?? []).length
    ? document
    : { ...document, authoredNotes: notes, updatedAt: Date.now() };
}

/** Notes remain attached to their original frame/page, but deleted references are exposed honestly. */
export function getPaperAuthoredNotesForPage(
  document: PaperDocument,
  pageId: string,
  kind?: PaperAuthoredNote['kind'],
): PaperAuthoredNote[] {
  return normalizePaperAuthoredNotes(document.authoredNotes)
    .filter((note) => note.pageId === pageId && (!kind || note.kind === kind));
}

export function paperAuthoredNoteNumber(
  document: PaperDocument,
  note: PaperAuthoredNote,
): number {
  return normalizePaperAuthoredNotes(document.authoredNotes)
    .filter((candidate) => candidate.kind === note.kind)
    .findIndex((candidate) => candidate.id === note.id) + 1;
}
