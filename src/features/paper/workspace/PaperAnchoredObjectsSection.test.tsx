// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addFrameToPaperPage,
  createDefaultPaperDocument,
  parsePaperDocument,
  resolvePaperPageFramesForCanvas,
  resolvePaperPageFramesForOutput,
  serializePaperDocument,
  updatePaperFrame,
} from '../../../lib/paperDocument';
import { usePaperStore } from '../../../store/paperStore';
import type { PaperDocument } from '../../../types/paper';
import { PaperAnchoredObjectsSection } from './PaperAnchoredObjectsSection';
import { PAPER_ANCHORED_OBJECT_LIMITS } from '../../../lib/paperAnchoredObjects';

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

describe('PaperAnchoredObjectsSection', () => {
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
        <PaperAnchoredObjectsSection
          document={document}
          page={document.pages[0]}
          selectedFrameId="figure"
        />,
      );
    });
  }

  function control<T extends HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(label: string): T {
    const element = host.querySelector<T>(`[aria-label="${label}"]`);
    if (!element) throw new Error(`Missing ${label}`);
    return element;
  }

  function setValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function selectValue(select: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('mounts create, relink/edit, undo/redo, save/reopen, output parity, and unlink on the real store', async () => {
    let document = createDefaultPaperDocument({ title: 'Anchored object controls' });
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      id: 'story', kind: 'text', xMm: 10, yMm: 10, widthMm: 30, heightMm: 40, text: 'Text that can reflow '.repeat(20),
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      id: 'caption', kind: 'caption', xMm: 50, yMm: 10, widthMm: 30, heightMm: 40, text: 'Caption owner',
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      id: 'figure', kind: 'image', xMm: 90, yMm: 90, widthMm: 10, heightMm: 10,
    }).document;
    usePaperStore.setState({
      activeDocumentId: document.id,
      document,
      selectedPageId: pageId,
      selectedFrameId: 'figure',
      selectedFrameIds: ['figure'],
      undoStack: [],
      redoStack: [],
    });
    render(document);

    expect(host.textContent).toContain('This object is not currently anchored.');
    await act(async () => {
      setValue(control<HTMLInputElement>('Anchor text offset'), '31');
      setValue(control<HTMLInputElement>('Anchor offset X mm'), '2.5');
      setValue(control<HTMLInputElement>('Anchor offset Y mm'), '-1');
      selectValue(control<HTMLSelectElement>('Missing anchor policy'), 'retain');
    });
    await act(async () => {
      Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Link object')!.click();
    });

    let linked = usePaperStore.getState().document;
    expect(linked.anchoredObjects).toEqual([{
      id: 'anchor-figure', objectFrameId: 'figure', anchorFrameId: 'story', textOffset: 31,
      offsetMm: { x: 2.5, y: -1 }, missingAnchorPolicy: 'retain',
    }]);
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
    const canvas = resolvePaperPageFramesForCanvas(linked, linked.pages[0]).find((frame) => frame.id === 'figure');
    const output = resolvePaperPageFramesForOutput(linked, linked.pages[0]).find((frame) => frame.id === 'figure');
    expect(canvas?.xMm).toBe(output?.xMm);
    expect(canvas?.yMm).toBe(output?.yMm);
    expect(parsePaperDocument(serializePaperDocument(linked)).anchoredObjects).toEqual(linked.anchoredObjects);

    render(linked);
    await act(async () => selectValue(control<HTMLSelectElement>('Text anchor owner'), 'caption'));
    await act(async () => {
      Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Update link')!.click();
    });
    linked = usePaperStore.getState().document;
    expect(linked.anchoredObjects?.[0]).toMatchObject({ anchorFrameId: 'caption', textOffset: 31, missingAnchorPolicy: 'retain' });

    await act(async () => usePaperStore.getState().undo());
    expect(usePaperStore.getState().document.anchoredObjects?.[0]?.anchorFrameId).toBe('story');
    await act(async () => usePaperStore.getState().redo());
    expect(usePaperStore.getState().document.anchoredObjects?.[0]?.anchorFrameId).toBe('caption');

    // Reflow applies the retained relationship without changing the original frame's authored coordinates.
    const reflowed = updatePaperFrame(usePaperStore.getState().document, pageId, 'caption', { text: 'Longer caption '.repeat(80) });
    expect(resolvePaperPageFramesForCanvas(reflowed, reflowed.pages[0]).find((frame) => frame.id === 'figure')?.yMm)
      .toBeGreaterThan(resolvePaperPageFramesForCanvas(linked, linked.pages[0]).find((frame) => frame.id === 'figure')!.yMm);

    render(usePaperStore.getState().document);
    await act(async () => control<HTMLButtonElement>('Unlink anchored object').click());
    expect(usePaperStore.getState().document.anchoredObjects).toEqual([]);
  });

  it('refuses a new relationship at the persisted cap without a false success or history entry', async () => {
    let document = createDefaultPaperDocument({ title: 'Bounded anchors' });
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      id: 'story', kind: 'text', xMm: 10, yMm: 10, widthMm: 30, heightMm: 40, text: 'Owner',
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      id: 'figure', kind: 'image', xMm: 50, yMm: 50, widthMm: 10, heightMm: 10,
    }).document;
    document = {
      ...document,
      anchoredObjects: Array.from({ length: PAPER_ANCHORED_OBJECT_LIMITS.maxObjects }, (_, index) => ({
        id: `anchor-${index}`,
        objectFrameId: `object-${index}`,
        anchorFrameId: `owner-${index}`,
        textOffset: 0,
        missingAnchorPolicy: 'hide' as const,
      })),
    };
    usePaperStore.setState({
      activeDocumentId: document.id,
      document,
      selectedPageId: pageId,
      selectedFrameId: 'figure',
      selectedFrameIds: ['figure'],
      undoStack: [],
      redoStack: [],
    });
    render(document);

    await act(async () => {
      Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Link object')!.click();
    });

    expect(host.textContent).toContain(`maximum of ${PAPER_ANCHORED_OBJECT_LIMITS.maxObjects} anchored objects`);
    expect(host.textContent).not.toContain('Linked the object to the selected text frame.');
    expect(usePaperStore.getState().document.anchoredObjects).toHaveLength(PAPER_ANCHORED_OBJECT_LIMITS.maxObjects);
    expect(usePaperStore.getState().undoStack).toHaveLength(0);
  });
});
