// @vitest-environment jsdom

// Reachability regression for MH-071: the Data Merge authoring section must be reachable from the
// real PaperInspector mount and drive the real paperStore document without any hand-stubbed route.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from '../../../lib/paperDocument';
import { usePaperStore } from '../../../store/paperStore';
import type { PaperDocument } from '../../../types/paper';
import { PaperInspector } from './PaperWorkspace';

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

vi.mock('../../../components/Common/BundledFontBrowser', () => ({
  BundledFontBrowser: () => <button type="button">Choose inspector authority font</button>,
}));
vi.mock('../assets/PaperAssetRuntime', () => ({ paperAssetRepository: {} }));
vi.mock('../../../store/alertDialogStore', () => ({ showAlertDialog: vi.fn(async () => undefined) }));

describe('Paper Inspector reaches the mounted Data Merge authoring route', () => {
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
        <PaperInspector
          canPasteStyle={false}
          document={document}
          documentTitle={document.title}
          frame={null}
          onAddParentPage={vi.fn()}
          onAddSelectedFrameToParent={vi.fn()}
          onAddSwatch={vi.fn()}
          onAssignParentPage={vi.fn()}
          onClearStyleLinks={vi.fn()}
          onClearStyleOverrides={vi.fn()}
          onChainBubbleWith={vi.fn()}
          onCopyStyle={vi.fn()}
          onDeletePage={vi.fn()}
          onEditComicSfxFrame={vi.fn()}
          onSendGeneratedMediaToFlow={vi.fn()}
          onPasteStyle={vi.fn()}
          onMoveBubbleInChain={vi.fn()}
          onRedefineStyle={vi.fn()}
          onRemoveSwatch={vi.fn()}
          onToggleViewOption={vi.fn()}
          onUnchainBubble={vi.fn()}
          onUpdateBubbleConnectorGeometry={vi.fn()}
          onUpdateDocumentSetup={usePaperStore.getState().updateDocumentSetup}
          onUpdatePublicationReferences={vi.fn()}
          onUpdateStyleAutomation={usePaperStore.getState().updateStyleAutomation}
          onUpdateFrame={vi.fn()}
          pageCount={document.pages.length}
          selectedPageNumber={1}
          status=""
        />,
      );
    });
  }

  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((candidate) => candidate.textContent?.includes(label));
  }

  it('exposes attach/preview/export controls that drive the real store', async () => {
    let document = createDefaultPaperDocument({ title: 'Reachable letter' });
    document = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text', xMm: 12, yMm: 12, widthMm: 80, heightMm: 30, text: 'To {{merge:name}}',
    }).document;
    usePaperStore.setState({
      activeDocumentId: document.id,
      document,
      selectedPageId: document.pages[0].id,
      undoStack: [],
      redoStack: [],
    });
    render(document);

    // Open the collapsible section exactly like a user would.
    const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'))
      .find((candidate) => candidate.textContent?.includes('Data merge'));
    expect(toggle).toBeTruthy();
    if (toggle!.getAttribute('aria-expanded') !== 'true') {
      await act(async () => toggle!.click());
    }
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');

    expect(host.textContent).toContain('No recipient source attached');
    expect(button('Attach CSV')).toBeTruthy();

    const area = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste bounded CSV"]');
    expect(area).toBeTruthy();
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(area!, 'name\nAda');
      area!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Attach CSV')!.click());

    const attached = usePaperStore.getState().document;
    expect(attached.dataMerge?.name).toBe('CSV data');
    expect(attached.dataMerge?.records.map((record) => record.id)).toEqual(['Ada']);
    expect(usePaperStore.getState().undoStack).toHaveLength(1);

    // The workspace passes the fresh document back down after every store change.
    render(usePaperStore.getState().document);
    expect(host.textContent).toContain('CSV data · 1 column(s) · 1 record(s)');
    expect(host.textContent).toContain('p1 · To Ada');
    expect(host.textContent).toContain('Derived identity:');
    expect(button('Download batch JSONL (1)')).toBeTruthy();
    // PDF routing is absent only because this test omits the optional export callback.
    expect(host.textContent).toContain('standard Paper print pipeline');

    await act(async () => button('Remove')!.click());
    expect('dataMerge' in usePaperStore.getState().document).toBe(false);
  });

  it('reaches the mounted anchored-object authoring route', async () => {
    let document = createDefaultPaperDocument({ title: 'Reachable anchors' });
    document = addFrameToPaperPage(document, document.pages[0].id, {
      id: 'story', kind: 'text', xMm: 12, yMm: 12, widthMm: 80, heightMm: 30, text: 'Anchor owner',
    }).document;
    document = addFrameToPaperPage(document, document.pages[0].id, {
      id: 'figure', kind: 'image', xMm: 12, yMm: 50, widthMm: 30, heightMm: 20,
    }).document;
    usePaperStore.setState({
      activeDocumentId: document.id,
      document,
      selectedPageId: document.pages[0].id,
      selectedFrameId: 'figure',
      selectedFrameIds: ['figure'],
      undoStack: [],
      redoStack: [],
    });
    render(document);

    const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'))
      .find((candidate) => candidate.textContent?.includes('Anchored objects'));
    expect(toggle).toBeTruthy();
    if (toggle!.getAttribute('aria-expanded') !== 'true') {
      await act(async () => toggle!.click());
    }
    expect(host.querySelector('[data-paper-anchored-objects="true"]')).toBeTruthy();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Anchored object frame"]')?.value).toBe('figure');
    expect(button('Link object')).toBeTruthy();
  });

  it('reaches the mounted authored footnote and endnote catalog', async () => {
    let document = createDefaultPaperDocument({ title: 'Reachable authored notes' });
    document = addFrameToPaperPage(document, document.pages[0].id, {
      id: 'reference', kind: 'text', xMm: 12, yMm: 12, widthMm: 80, heightMm: 30, text: 'Reference owner',
    }).document;
    usePaperStore.setState({
      activeDocumentId: document.id,
      document,
      selectedPageId: document.pages[0].id,
      selectedFrameId: 'reference',
      selectedFrameIds: ['reference'],
      undoStack: [],
      redoStack: [],
    });
    render(document);

    const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'))
      .find((candidate) => candidate.textContent?.includes('Footnotes & endnotes'));
    expect(toggle).toBeTruthy();
    if (toggle!.getAttribute('aria-expanded') !== 'true') {
      await act(async () => toggle!.click());
    }
    expect(host.querySelector('[data-paper-authored-notes-catalog="true"]')).toBeTruthy();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Authored note page"]')?.value).toBe(document.pages[0].id);
    expect(button('Add note')).toBeTruthy();
  });
});
