// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const backing = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => backing.set(key, String(value)),
      removeItem: (key: string) => backing.delete(key),
      clear: () => backing.clear(),
      key: () => null,
      length: 0,
    },
  });
});

import { createDefaultPaperDocument } from '../../../lib/paperDocument';
import {
  addPaperReviewComment,
  addPaperReviewReply,
  setPaperReviewCommentResolved,
} from '../../../lib/paperReviewComments';
import { useSettingsStore } from '../../../store/settingsStore';
import type { PaperDocument } from '../../../types/paper';
import { PaperReviewCommentsPanel } from './PaperReviewCommentsPanel';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const callbacks = {
  onAddComment: vi.fn(({ body }: { body: string }) => `created-${body.length}`),
  onAddReply: vi.fn(() => 'created-reply'),
  onDeleteComment: vi.fn(),
  onSetResolved: vi.fn(),
};

function click(element: Element | null | undefined): void {
  expect(element, 'click target exists').toBeTruthy();
  act(() => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function change(element: Element | null | undefined, value: string): void {
  expect(element, 'input target exists').toBeTruthy();
  act(() => {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function renderPanel(document: PaperDocument, selectedPageId?: string): void {
  host = createHost();
  root = createRoot(host);
  act(() => {
    root!.render(
      <PaperReviewCommentsPanel
        document={document}
        onAddComment={callbacks.onAddComment}
        onAddReply={callbacks.onAddReply}
        onDeleteComment={callbacks.onDeleteComment}
        onSetResolved={callbacks.onSetResolved}
        selectedPageId={selectedPageId ?? document.pages[0]!.id}
      />,
    );
  });
}

function createHost(): HTMLDivElement {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  return container;
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' });
  callbacks.onAddComment.mockClear();
  callbacks.onAddReply.mockClear();
  callbacks.onDeleteComment.mockClear();
  callbacks.onSetResolved.mockClear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
});

describe('PaperReviewCommentsPanel', () => {
  it('shows an honest empty state with the help copy that comments never export', () => {
    renderPanel(createDefaultPaperDocument({ title: 'No comments' }));
    const panel = window.document.querySelector('[data-paper-review-comments-panel]');
    expect(panel?.textContent).toContain('never exported');
    expect(panel?.textContent).toContain('No review comments yet.');
    expect(panel?.textContent).toContain('0 open');
  });

  it('adds a comment on the selected page through the composer', () => {
    const document = createDefaultPaperDocument({ title: 'Composer' });
    renderPanel(document, document.pages[0]!.id);

    change(window.document.querySelector('[aria-label="Reviewer name"]'), 'Vera');
    change(window.document.querySelector('[aria-label="Comment text"]'), 'Tighten the caption leading.');
    click([...window.document.querySelectorAll('button')].find((button) => button.textContent?.includes('Add comment')));

    expect(callbacks.onAddComment).toHaveBeenCalledTimes(1);
    expect(callbacks.onAddComment).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: document.pages[0]!.id, author: 'Vera', body: 'Tighten the caption leading.' }),
    );
  });

  it('keeps the composer disabled until text is entered and ignores whitespace-only bodies', () => {
    const document = createDefaultPaperDocument({ title: 'Guard' });
    renderPanel(document);

    const addButtons = [...window.document.querySelectorAll('button')]
      .filter((button) => button.textContent?.includes('Add comment'));
    expect(addButtons).toHaveLength(1);
    expect((addButtons[0] as HTMLButtonElement).disabled).toBe(true);

    change(window.document.querySelector('[aria-label="Comment text"]'), '   ');
    expect((addButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders threads with replies, resolution badges, and honest anchor states', () => {
    let document = createDefaultPaperDocument({ title: 'Threads' });
    const pageId = document.pages[0]!.id;
    const first = addPaperReviewComment(document, { pageId, author: 'Vera', body: 'Move the balloon up.' }, 1_000);
    document = first.document;
    document = addPaperReviewReply(document, first.comment!.id, { author: 'Sol', body: 'Agreed, doing it now.' }, 2_000).document;
    const second = addPaperReviewComment(document, { pageId: 'deleted-page', author: 'Iris', body: 'Old anchor.' }, 3_000);
    document = second.document;
    document = addPaperReviewComment(document, { pageId, frameId: 'gone-frame', author: 'June', body: 'Frame note.' }, 4_000).document;
    document = setPaperReviewCommentResolved(document, first.comment!.id, true, 5_000);

    renderPanel(document);

    const threads = [...window.document.querySelectorAll('[data-paper-review-comment-id]')];
    expect(threads).toHaveLength(3);

    const resolvedThread = window.document.querySelector(`[data-paper-review-comment-id="${first.comment!.id}"]`);
    expect(resolvedThread?.textContent).toContain('Resolved');
    expect(resolvedThread?.textContent).toContain('Agreed, doing it now.');
    expect(resolvedThread?.querySelector('[data-review-anchor-state="anchored"]')).toBeTruthy();

    const missingPageThread = window.document.querySelector(`[data-paper-review-comment-id="${second.comment!.id}"]`);
    expect(missingPageThread?.querySelector('[data-review-anchor-state="page-missing"]')?.textContent)
      .toContain('Anchored page was deleted');

    const frameThread = [...window.document.querySelectorAll('[data-paper-review-comment-id]')]
      .find((thread) => thread.querySelector('[data-review-anchor-state="frame-missing"]'));
    expect(frameThread?.textContent).toContain('Frame note.');
  });

  it('hides resolved threads behind the toggle and reopens one through the reopen action', () => {
    let document = createDefaultPaperDocument({ title: 'Toggle' });
    const pageId = document.pages[0]!.id;
    const added = addPaperReviewComment(document, { pageId, author: 'Vera', body: 'Resolve me.' }, 1_000);
    document = setPaperReviewCommentResolved(added.document, added.comment!.id, true, 2_000);

    renderPanel(document);
    expect(window.document.querySelectorAll('[data-paper-review-comment-id]')).toHaveLength(1);

    click([...window.document.querySelectorAll('button')].find((button) => button.textContent?.includes('Hide resolved')));
    expect(window.document.querySelectorAll('[data-paper-review-comment-id]')).toHaveLength(0);

    click([...window.document.querySelectorAll('button')].find((button) => button.textContent?.includes('Show resolved')));
    const reopenButton = window.document.querySelector('button[aria-label="Reopen thread"]');
    click(reopenButton);
    expect(callbacks.onSetResolved).toHaveBeenCalledWith(added.comment!.id, false);
  });

  it('requires an explicit confirm step before deleting a thread', () => {
    let document = createDefaultPaperDocument({ title: 'Delete guard' });
    const pageId = document.pages[0]!.id;
    const added = addPaperReviewComment(document, { pageId, author: 'Vera', body: 'Delete me.' }, 1_000);
    document = added.document;

    renderPanel(document);
    const thread = window.document.querySelector(`[data-paper-review-comment-id="${added.comment!.id}"]`);

    click(thread?.querySelector('button[aria-label="Delete thread"]'));
    expect(callbacks.onDeleteComment).not.toHaveBeenCalled();
    expect(window.document.querySelector('[data-review-delete-confirm]')).toBeTruthy();

    click(window.document.querySelector('[data-review-delete-confirm]'));
    expect(callbacks.onDeleteComment).toHaveBeenCalledWith(added.comment!.id);
  });

  it('sends bounded replies through the per-thread composer', () => {
    let document = createDefaultPaperDocument({ title: 'Reply flow' });
    const pageId = document.pages[0]!.id;
    const added = addPaperReviewComment(document, { pageId, author: 'Vera', body: 'Reply to me.' }, 1_000);
    document = added.document;

    renderPanel(document);
    const thread = window.document.querySelector(`[data-paper-review-comment-id="${added.comment!.id}"]`);
    change(thread?.querySelector('input[aria-label="Reply text"]'), 'Here is my reply.');

    const replyButton = [...(thread?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent === 'Reply');
    click(replyButton);

    expect(callbacks.onAddReply).toHaveBeenCalledWith(added.comment!.id, expect.objectContaining({ body: 'Here is my reply.' }));
  });
});
