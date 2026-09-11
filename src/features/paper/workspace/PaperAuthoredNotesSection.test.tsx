// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addFrameToPaperPage,
  addPaperPage,
  createDefaultPaperDocument,
  exportPaperDocumentToPrintHtml,
  parsePaperDocument,
  serializePaperDocument,
} from '../../../lib/paperDocument';
import { usePaperStore } from '../../../store/paperStore';
import type { PaperDocument } from '../../../types/paper';
import { PaperAuthoredNotesSection } from './PaperAuthoredNotesSection';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
});

describe('PaperAuthoredNotesSection', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function render(document: PaperDocument) {
    act(() => {
      root.render(
        <PaperAuthoredNotesSection
          document={document}
          page={document.pages[0]!}
          selectedFrameId="reference"
        />,
      );
    });
  }

  function control<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(label: string): T {
    const element = host.querySelector<T>(`[aria-label="${label}"]`);
    if (!element) throw new Error(`Missing ${label}`);
    return element;
  }

  function setText(area: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function selectValue(select: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function button(label: string): HTMLButtonElement {
    const element = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((candidate) => candidate.textContent?.trim() === label);
    if (!element) throw new Error(`Missing ${label}`);
    return element;
  }

  it('mounts add, edit, remove, history, save/reopen, and page/final-page rendering through the real store', async () => {
    let document = createDefaultPaperDocument({ title: 'Authored note catalog' });
    const firstPageId = document.pages[0]!.id;
    document = addFrameToPaperPage(document, firstPageId, {
      id: 'reference', kind: 'text', xMm: 12, yMm: 12, widthMm: 80, heightMm: 20, text: 'Reference frame',
    }).document;
    document = addPaperPage(document);
    usePaperStore.setState({
      activeDocumentId: document.id,
      document,
      selectedPageId: firstPageId,
      selectedFrameId: 'reference',
      selectedFrameIds: ['reference'],
      undoStack: [],
      redoStack: [],
    });
    render(document);

    expect(host.querySelector('[data-paper-authored-notes-catalog="true"]')).toBeTruthy();
    await act(async () => setText(control<HTMLTextAreaElement>('Authored note text'), 'Footnote <safe>'));
    await act(async () => button('Add note').click());
    let updated = usePaperStore.getState().document;
    const footnote = updated.authoredNotes?.[0];
    expect(footnote).toMatchObject({ kind: 'footnote', body: 'Footnote <safe>', pageId: firstPageId, frameId: 'reference' });
    expect(usePaperStore.getState().undoStack).toHaveLength(1);

    render(updated);
    await act(async () => selectValue(control<HTMLSelectElement>('Authored note kind'), 'endnote'));
    await act(async () => selectValue(control<HTMLSelectElement>('Authored note frame'), ''));
    await act(async () => setText(control<HTMLTextAreaElement>('Authored note text'), 'Endnote & safe'));
    await act(async () => button('Add note').click());
    updated = usePaperStore.getState().document;
    const endnote = updated.authoredNotes?.find((note) => note.kind === 'endnote');
    expect(endnote).toBeTruthy();
    expect(usePaperStore.getState().undoStack).toHaveLength(2);

    const reopened = parsePaperDocument(serializePaperDocument(updated));
    expect(reopened.authoredNotes).toEqual(updated.authoredNotes);
    const html = exportPaperDocumentToPrintHtml(reopened, { includeProductionMarks: false });
    expect(html).toContain('data-paper-note-kind="footnote"');
    expect(html).toContain('Footnote &lt;safe&gt;');
    expect(html).toContain('data-paper-note-kind="endnote"');
    expect(html).toContain('Endnote &amp; safe');
    expect(html.indexOf('Endnote &amp; safe')).toBeGreaterThan(html.indexOf(`data-page="${reopened.pages[1]!.pageNumber}"`));

    render(updated);
    await act(async () => control<HTMLButtonElement>(`Edit authored note ${footnote!.id}`).click());
    await act(async () => setText(control<HTMLTextAreaElement>('Authored note text'), 'Updated footnote'));
    await act(async () => button('Update note').click());
    updated = usePaperStore.getState().document;
    expect(updated.authoredNotes?.find((note) => note.id === footnote!.id)).toMatchObject({
      body: 'Updated footnote', createdAt: footnote!.createdAt,
    });

    render(updated);
    await act(async () => control<HTMLButtonElement>(`Remove authored note ${endnote!.id}`).click());
    expect(usePaperStore.getState().document.authoredNotes).toHaveLength(1);
    await act(async () => usePaperStore.getState().undo());
    expect(usePaperStore.getState().document.authoredNotes).toHaveLength(2);
    await act(async () => usePaperStore.getState().redo());
    expect(usePaperStore.getState().document.authoredNotes).toHaveLength(1);
  });
});
