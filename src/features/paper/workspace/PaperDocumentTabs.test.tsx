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

const saveMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/automationBypass', () => ({
  shouldBypassConfirmations: () => false,
}));

vi.mock('../../../lib/paperDocumentSave', () => ({
  savePaperDocumentEditable: saveMock,
}));

import { PaperLossPreventionDialog } from '../../../components/Common/PaperLossPreventionDialog';
import { createDefaultPaperDocument } from '../../../lib/paperDocument';
import {
  resetPaperLossPreventionForTests,
  usePaperLossPreventionStore,
} from '../../../store/paperLossPreventionStore';
import { usePaperStore } from '../../../store/paperStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { PaperDocumentTabs } from './PaperDocumentTabs';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function resetPaper() {
  const document = createDefaultPaperDocument({ title: 'Close contract' });
  usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
}

async function mountTabs() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<><PaperDocumentTabs /><PaperLossPreventionDialog /></>);
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' });
  resetPaperLossPreventionForTests();
  resetPaper();
  saveMock.mockReset();
});

afterEach(async () => {
  resetPaperLossPreventionForTests();
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe('PaperDocumentTabs dirty close contract', () => {
  it('renders Japanese dynamic tab, plural, dirty, close, and tooltip copy', async () => {
    useSettingsStore.setState({ locale: 'ja' });
    usePaperStore.getState().addPage();
    const documentId = usePaperStore.getState().activeDocumentId;
    await mountTabs();

    const tabList = host?.querySelector<HTMLElement>('[role="tablist"]');
    const tab = host?.querySelector<HTMLElement>('[role="tab"]');
    expect(tabList?.getAttribute('aria-label')).toBe('開いている Paper ドキュメント');
    expect(button('新規 Paper ドキュメント').title).toBe('新規 Paper ドキュメント');
    expect(tab?.title).toBe('未保存の変更・Close contract・2 ページ');
    expect(tab?.textContent).toContain('2頁');
    expect(tab?.querySelector('[aria-label="未保存の変更"]')).not.toBeNull();
    expect(button('「Close contract」を閉じる').title).toBe('「Close contract」を閉じる');
    expect(usePaperStore.getState().activeDocumentId).toBe(documentId);
  });

  it('renders the Japanese recovery action with its document title', async () => {
    useSettingsStore.setState({ locale: 'ja' });
    usePaperStore.getState().addFrame('text', { id: 'recover-ja', text: '復元する本文' });
    const discardedId = usePaperStore.getState().activeDocumentId;
    expect(usePaperStore.getState().closeDocument(discardedId, { discard: true })).toBe(true);
    await mountTabs();

    const restore = button('破棄した Paper ドキュメント「Close contract」を復元');
    expect(restore.title).toBe('破棄した「Close contract」を復元');
  });

  it('settles the visible and queued requests as Cancel when the dialog unmounts', async () => {
    const firstSave = vi.fn(async () => ({ status: 'success' as const }));
    const secondSave = vi.fn(async () => ({ status: 'success' as const }));
    await mountTabs();
    let first!: Promise<'save' | 'discard' | 'cancel'>;
    let second!: Promise<'save' | 'discard' | 'cancel'>;
    await act(async () => {
      first = usePaperLossPreventionStore.getState().requestDecision({
        key: 'unmount', title: 'First unmount request', message: 'First', documentTitles: ['First'], save: firstSave,
      });
      second = usePaperLossPreventionStore.getState().requestDecision({
        key: 'unmount', title: 'Second unmount request', message: 'Second', documentTitles: ['Second'], save: secondSave,
      });
      await Promise.resolve();
    });

    await act(async () => root?.unmount());
    root = undefined;

    await expect(first).resolves.toBe('cancel');
    await expect(second).resolves.toBe('cancel');
    expect(firstSave).not.toHaveBeenCalled();
    expect(secondSave).not.toHaveBeenCalled();
    expect(usePaperLossPreventionStore.getState().activeRequest).toBeNull();
  });

  it('closes a clean tab directly without opening a decision dialog', async () => {
    const closedId = usePaperStore.getState().activeDocumentId;
    await mountTabs();
    await click(button('Close Close contract'));

    expect(host?.querySelector('[role="alertdialog"]')).toBeNull();
    expect(usePaperStore.getState().documents.map((entry) => entry.id)).not.toContain(closedId);
  });

  it('offers accessible Save, Discard, and Cancel and Cancel preserves exact editor state', async () => {
    usePaperStore.getState().addFrame('text', { id: 'selected-copy', text: 'Keep me' });
    const before = usePaperStore.getState();
    await mountTabs();
    await click(button('Close Close contract'));

    const dialog = host?.querySelector('[role="alertdialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(button('Save')).toBeDefined();
    expect(button('Discard')).toBeDefined();
    await click(button('Cancel'));

    const after = usePaperStore.getState();
    expect(after.document).toBe(before.document);
    expect(after.activeDocumentId).toBe(before.activeDocumentId);
    expect(after.selectedFrameId).toBe(before.selectedFrameId);
    expect(after.undoStack).toBe(before.undoStack);
    expect(host?.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('treats Escape as Cancel', async () => {
    usePaperStore.getState().addPage();
    const documentId = usePaperStore.getState().activeDocumentId;
    await mountTabs();
    await click(button('Close Close contract'));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(usePaperStore.getState().activeDocumentId).toBe(documentId);
    expect(host?.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('closes only after acknowledged Save success', async () => {
    usePaperStore.getState().addPage();
    const documentId = usePaperStore.getState().activeDocumentId;
    saveMock.mockImplementation(async () => {
      usePaperStore.getState().markDocumentSaved(documentId, {
        kind: 'standalone',
        path: '/layouts/close-contract.slppr',
      });
      return { status: 'success', path: '/layouts/close-contract.slppr' };
    });
    await mountTabs();
    await click(button('Close Close contract'));
    await click(button('Save'));

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(usePaperStore.getState().documents.map((entry) => entry.id)).not.toContain(documentId);
    expect(host?.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('keeps the decision open when a successful write leaves a newer authored edit dirty', async () => {
    usePaperStore.getState().addPage();
    const documentId = usePaperStore.getState().activeDocumentId;
    saveMock.mockResolvedValue({ status: 'success', path: '/layouts/older-version.slppr' });
    await mountTabs();
    await click(button('Close Close contract'));
    await click(button('Save'));

    expect(usePaperStore.getState().documents.map((entry) => entry.id)).toContain(documentId);
    expect(host?.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(host?.textContent).toContain('changed while it was being saved');
  });

  it.each([
    ['canceled', { status: 'canceled' }],
    ['failed', { status: 'failed', error: 'Disk full' }],
  ] as const)('preserves the dirty tab when Save is %s', async (_label, result) => {
    usePaperStore.getState().addPage();
    const before = usePaperStore.getState();
    saveMock.mockResolvedValue(result);
    await mountTabs();
    await click(button('Close Close contract'));
    await click(button('Save'));

    const after = usePaperStore.getState();
    expect(after.document).toBe(before.document);
    expect(after.activeDocumentId).toBe(before.activeDocumentId);
    expect(after.undoStack).toBe(before.undoStack);
    expect(host?.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(host?.textContent).toContain(result.status === 'failed' ? 'Disk full' : 'Save was canceled');
  });

  it('requires explicit Discard and retains a recoverable snapshot', async () => {
    usePaperStore.getState().addFrame('text', { id: 'discard-copy', text: 'Recoverable' });
    const documentId = usePaperStore.getState().activeDocumentId;
    await mountTabs();
    await click(button('Close Close contract'));
    await click(button('Discard'));

    expect(usePaperStore.getState().documents.map((entry) => entry.id)).not.toContain(documentId);
    expect(usePaperStore.getState().discardedDocumentRecoveries.at(-1)?.snapshot.document.pages[0].frames)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'discard-copy', text: 'Recoverable' })]));
  });

  it('applies the same guarded close to middle click without duplicate dialogs or recovery copies', async () => {
    usePaperStore.getState().addPage();
    await mountTabs();
    const tab = host?.querySelector<HTMLElement>('[role="tab"]');
    expect(tab).toBeTruthy();
    await act(async () => {
      tab?.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
      tab?.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
    });

    expect(host?.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    await click(button('Discard'));
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(1);
  });
});
