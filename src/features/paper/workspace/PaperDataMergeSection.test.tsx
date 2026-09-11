// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperDocumentSetup } from '../../../lib/paperDocument';
import { normalizePaperDataMergeSource } from '../../../lib/paperDataMerge';
import { usePaperStore } from '../../../store/paperStore';
import type { PaperDocument } from '../../../types/paper';
import { PaperDataMergeSection } from './PaperDataMergeSection';

const mocks = vi.hoisted(() => ({
  downloadTextFileWithOutcome: vi.fn(
    async (_fileName?: string, _contents?: string, _mimeType?: string) =>
      ({ status: 'started', platform: 'browser' }) as const,
  ),
}));

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

vi.mock('../../../lib/downloadAsset', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/downloadAsset')>()),
  downloadTextFileWithOutcome: mocks.downloadTextFileWithOutcome,
}));

function documentWithTemplate(): PaperDocument {
  let document = createDefaultPaperDocument({ title: 'Merge letter' });
  document = addFrameToPaperPage(document, document.pages[0].id, {
    kind: 'text', xMm: 12, yMm: 12, widthMm: 80, heightMm: 30, text: 'To {{merge:name}}',
  }).document;
  return document;
}

function attachedSource() {
  return normalizePaperDataMergeSource({
    version: 1,
    name: 'Guests',
    columns: [{ name: 'name' }, { name: 'email' }],
    records: [
      { id: 'ada', values: { name: 'Ada', email: 'ada@example.test' } },
      { id: 'grace', values: { name: 'Grace', email: '' } },
    ],
  })!;
}

describe('PaperDataMergeSection', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.downloadTextFileWithOutcome.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function render(document: PaperDocument, onExportDerivedPdf?: (derived: PaperDocument) => void) {
    act(() => {
      root.render(<PaperDataMergeSection document={document} onExportDerivedPdf={onExportDerivedPdf} />);
    });
  }

  function button(label: string): HTMLButtonElement | undefined {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((candidate) => candidate.textContent?.includes(label));
  }

  async function pasteAndAttach(csv: string) {
    const area = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Paste bounded CSV"]');
    if (!area) throw new Error('paste field missing');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(area, csv);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Attach CSV')!.click());
  }

  function seedStore(document: PaperDocument) {
    usePaperStore.setState({
      activeDocumentId: document.id,
      document,
      selectedPageId: document.pages[0].id,
      undoStack: [],
      redoStack: [],
    });
  }

  it('offers attach/clear/preview controls and reports an explicit bounded failure without attaching', async () => {
    const document = documentWithTemplate();
    seedStore(document);
    render(document);
    expect(host.textContent).toContain('No recipient source attached');

    await pasteAndAttach('Bad Header,x\n1,2');
    expect(host.textContent).toContain('(code: invalid-header)');
    // The rejected import changed nothing anywhere.
    expect('dataMerge' in usePaperStore.getState().document).toBe(false);
    expect(usePaperStore.getState().document).toBe(document);
    expect(document.pages[0].frames[0].text).toBe('To {{merge:name}}');
  });

  it('attaches a parsed source through the store and clears it on demand', async () => {
    const document = documentWithTemplate();
    seedStore(document);
    render(document);

    await pasteAndAttach('name,email\nAda,ada@example.test');
    const attached = usePaperStore.getState().document;
    expect(attached.dataMerge?.name).toBe('CSV data');
    expect(attached.dataMerge?.columns.map((column) => column.name)).toEqual(['name', 'email']);
    expect(attached.dataMerge?.records).toHaveLength(1);
    expect(usePaperStore.getState().undoStack.length).toBeGreaterThan(0);
    expect(host.textContent).toContain('Every accepted value is preserved');

    // The inspector remounts with each store change in the workspace; mirror that here.
    render(usePaperStore.getState().document);
    await act(async () => button('Remove')!.click());
    expect('dataMerge' in usePaperStore.getState().document).toBe(false);
  });

  it('previews one derived record without mutating the template and routes its PDF export callback', async () => {
    const document = documentWithTemplate();
    const source = attachedSource();
    usePaperStore.setState({
      activeDocumentId: document.id,
      document: { ...document, dataMerge: source },
      undoStack: [],
      redoStack: [],
    });
    const exportSpy = vi.fn();
    render(usePaperStore.getState().document, exportSpy);

    expect(host.textContent).toContain('Guests · 2 column(s) · 2 record(s)');
    expect(host.textContent).toContain('p1 · To Ada');
    expect(host.textContent).toContain('Missing on this record: none');
    const before = usePaperStore.getState().document;

    await act(async () => button('Print / PDF this record…')!.click());
    expect(exportSpy).toHaveBeenCalledTimes(1);
    const derived = exportSpy.mock.calls[0][0] as PaperDocument;
    expect(derived.id).not.toBe(document.id);
    expect(derived.id.startsWith(`${document.id}-merge-ada`)).toBe(true);
    expect(derived.id.length).toBeLessThanOrEqual(192);
    expect(derived.title).toContain('ada');
    expect(derived.pages[0].frames[0].text).toBe('To Ada');
    expect(document.pages[0].frames[0].text).toBe('To {{merge:name}}');
    expect(usePaperStore.getState().document).toBe(before);
  });

  it('preserves a commercial PDF/X target on the derived export callback for the parent gate', async () => {
    const document = updatePaperDocumentSetup(documentWithTemplate(), {
      printProduction: {
        pdfStandard: 'pdf-x-4',
        outputIntentProfileId: 'pso-coated-v3-fogra51',
      },
    });
    usePaperStore.setState({
      activeDocumentId: document.id,
      document: { ...document, dataMerge: attachedSource() },
      undoStack: [],
      redoStack: [],
    });
    const exportSpy = vi.fn();
    render(usePaperStore.getState().document, exportSpy);

    await act(async () => button('Print / PDF this record…')!.click());
    expect(exportSpy).toHaveBeenCalledTimes(1);
    expect((exportSpy.mock.calls[0][0] as PaperDocument).printProduction).toEqual(document.printProduction);
  });

  it('downloads deterministic JSONL for every record through the shared file saver', async () => {
    const document = documentWithTemplate();
    usePaperStore.setState({
      activeDocumentId: document.id,
      document: { ...document, dataMerge: attachedSource() },
      undoStack: [],
      redoStack: [],
    });
    render(usePaperStore.getState().document);

    await act(async () => button('Download batch JSONL (2)')!.click());
    expect(mocks.downloadTextFileWithOutcome).toHaveBeenCalledTimes(1);
    const [fileName, contents, mimeType] = mocks.downloadTextFileWithOutcome.mock.calls[0];
    expect(fileName?.endsWith('.jsonl')).toBe(true);
    expect(mimeType).toBe('application/x-ndjson');
    const lines = (contents ?? '').split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).recordId).toBe('ada');
    expect(JSON.parse(lines[1]).resolvedFields).toEqual(['name']);
    // Two consecutive exports stay byte-identical.
    await act(async () => button('Download batch JSONL (2)')!.click());
    expect(mocks.downloadTextFileWithOutcome.mock.calls[1][1]).toBe(contents);
  });
});
