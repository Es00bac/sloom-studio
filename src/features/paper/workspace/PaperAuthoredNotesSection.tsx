import { useState } from 'react';
import {
  PAPER_AUTHORED_NOTE_BODY_MAX_LENGTH,
  PAPER_AUTHORED_NOTES_MAX,
} from '../../../lib/paperAuthoredNotes';
import { usePaperStore } from '../../../store/paperStore';
import type { PaperAuthoredNote, PaperDocument, PaperPage } from '../../../types/paper';

export interface PaperAuthoredNotesSectionProps {
  document: PaperDocument;
  page: PaperPage;
  selectedFrameId?: string;
}

/**
 * Mounted authoring route for the bounded Paper footnote/endnote catalog.
 * Rendering stays in paperDocument; this section only makes the existing
 * history-aware store actions reachable from the Paper Inspector.
 */
export function PaperAuthoredNotesSection({
  document,
  page,
  selectedFrameId,
}: PaperAuthoredNotesSectionProps) {
  const addAuthoredNote = usePaperStore((state) => state.addAuthoredNote);
  const updateAuthoredNote = usePaperStore((state) => state.updateAuthoredNote);
  const removeAuthoredNote = usePaperStore((state) => state.removeAuthoredNote);
  const notes = document.authoredNotes ?? [];
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [kind, setKind] = useState<PaperAuthoredNote['kind']>('footnote');
  const [body, setBody] = useState('');
  const [pageId, setPageId] = useState(page.id);
  const [frameId, setFrameId] = useState(selectedFrameId ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const selectedPage = document.pages.find((candidate) => candidate.id === pageId) ?? page;

  const resetDraft = () => {
    setEditingNoteId(null);
    setKind('footnote');
    setBody('');
    setPageId(page.id);
    setFrameId(selectedFrameId ?? '');
  };

  const beginEdit = (note: PaperAuthoredNote) => {
    setEditingNoteId(note.id);
    setKind(note.kind);
    setBody(note.body);
    setPageId(note.pageId);
    setFrameId(note.frameId ?? '');
    setStatus(null);
  };

  const submit = () => {
    const draft = {
      kind,
      body,
      pageId,
      ...(frameId ? { frameId } : {}),
    };
    const result = editingNoteId
      ? updateAuthoredNote({ ...draft, id: editingNoteId })
      : addAuthoredNote(draft);
    if (!result) {
      setStatus('The note was not saved. Choose a current page and optional frame, then enter bounded note text.');
      return;
    }
    setStatus(editingNoteId ? 'Updated the authored note.' : 'Added the authored note.');
    resetDraft();
  };

  const remove = (note: PaperAuthoredNote) => {
    removeAuthoredNote(note.id);
    if (editingNoteId === note.id) resetDraft();
    setStatus('Removed the authored note.');
  };

  return (
    <div className="space-y-2" data-paper-authored-notes-catalog="true">
      <p className="text-[11px] leading-4 text-cyan-100/50">
        Author bounded local footnotes and endnotes. Footnotes print on their selected page; endnotes collect on the final page.
        No citation manager, automatic pagination, or imported-note rewrite is performed.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="block text-[10px] uppercase tracking-[0.14em] text-cyan-100/40">Kind</span>
          <select aria-label="Authored note kind" className="paper-input" onChange={(event) => setKind(event.target.value as PaperAuthoredNote['kind'])} value={kind}>
            <option value="footnote">Footnote</option>
            <option value="endnote">Endnote</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="block text-[10px] uppercase tracking-[0.14em] text-cyan-100/40">Page anchor</span>
          <select
            aria-label="Authored note page"
            className="paper-input"
            onChange={(event) => {
              setPageId(event.target.value);
              setFrameId('');
            }}
            value={selectedPage.id}
          >
            {document.pages.map((candidate) => <option key={candidate.id} value={candidate.id}>Page {candidate.pageNumber}</option>)}
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="block text-[10px] uppercase tracking-[0.14em] text-cyan-100/40">Optional frame anchor</span>
        <select aria-label="Authored note frame" className="paper-input" onChange={(event) => setFrameId(event.target.value)} value={frameId}>
          <option value="">Page only</option>
          {selectedPage.frames.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label || `${candidate.kind} frame`}</option>)}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="block text-[10px] uppercase tracking-[0.14em] text-cyan-100/40">Note text</span>
        <textarea
          aria-label="Authored note text"
          className="paper-input min-h-16 w-full"
          maxLength={PAPER_AUTHORED_NOTE_BODY_MAX_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Bounded plain-text note"
          value={body}
        />
      </label>
      <div className="flex gap-2">
        <button
          className="flex-1 rounded border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100/80 hover:border-cyan-300/50 disabled:opacity-40"
          disabled={!body.trim() || (!editingNoteId && notes.length >= PAPER_AUTHORED_NOTES_MAX)}
          onClick={submit}
          type="button"
        >
          {editingNoteId ? 'Update note' : 'Add note'}
        </button>
        {editingNoteId ? (
          <button className="rounded border border-cyan-300/20 px-2 py-1 text-xs text-cyan-100/65 hover:border-cyan-300/50" onClick={resetDraft} type="button">Cancel edit</button>
        ) : null}
      </div>
      {notes.length >= PAPER_AUTHORED_NOTES_MAX && !editingNoteId ? (
        <div className="text-[11px] text-amber-100/75">This document has reached its maximum of {PAPER_AUTHORED_NOTES_MAX} authored notes.</div>
      ) : null}
      {status ? <div className="text-[11px] text-cyan-100/60" role="status">{status}</div> : null}
      {notes.length ? (
        <div className="space-y-1 rounded border border-cyan-300/10 bg-[#0b121d] p-1.5">
          {notes.map((note) => {
            const notePage = document.pages.find((candidate) => candidate.id === note.pageId);
            return (
              <div className="rounded border border-cyan-300/10 p-1.5 text-[11px] text-cyan-100/65" key={note.id}>
                <div className="flex items-center justify-between gap-2">
                  <span>{note.kind === 'footnote' ? 'Footnote' : 'Endnote'} · p{notePage?.pageNumber ?? '?'}</span>
                  <span className="flex gap-1">
                    <button aria-label={`Edit authored note ${note.id}`} className="rounded border border-cyan-300/20 px-1.5 py-0.5" onClick={() => beginEdit(note)} type="button">Edit</button>
                    <button aria-label={`Remove authored note ${note.id}`} className="rounded border border-rose-300/20 px-1.5 py-0.5 text-rose-100/70" onClick={() => remove(note)} type="button">Remove</button>
                  </span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-cyan-100/45">{note.body}</div>
                {note.frameId ? <div className="mt-1 font-mono text-[10px] text-cyan-100/35">frame: {note.frameId}</div> : null}
              </div>
            );
          })}
        </div>
      ) : <div className="text-[11px] text-cyan-100/35">No authored footnotes or endnotes yet.</div>}
    </div>
  );
}
