// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: () => null,
      length: 0,
    },
  });
});

import { createDefaultPaperDocument } from '../../../lib/paperDocument';
import type { OpenFontLibraryFace } from '../../../lib/paperOpenFontCatalog';
import { usePaperStore } from '../../../store/paperStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { PaperFontImportControl } from './PaperFontImport';

const SHA = 'a'.repeat(64);
const LICENSE_SHA = 'b'.repeat(64);

function managedLibraryFace(): OpenFontLibraryFace {
  return {
    subset: 'latin',
    retrievedAt: 1,
    face: {
      id: 'open-example-sans-latin-400-normal',
      familyId: 'example-sans',
      familyName: 'Example Sans',
      postscriptName: 'ExampleSans-Regular',
      weight: 400,
      style: 'normal',
      stretchPercent: 100,
      collectionIndex: 0,
      variableAxes: {},
      unicodeRanges: [{ start: 0x20, end: 0x7e }],
      format: 'truetype',
      fontAsset: { id: `sha256:${SHA}`, sha256: SHA, mimeType: 'font/ttf', byteLength: 4 },
      embeddability: 'installable',
      canSubset: true,
      source: { kind: 'open-catalog', url: 'https://example.test/example-sans.ttf', version: '1.0.0' },
      license: { id: 'OFL-1.1', textAsset: { id: `sha256:${LICENSE_SHA}`, sha256: LICENSE_SHA, mimeType: 'text/plain', byteLength: 4 } },
    },
  };
}

function resetPaperStore() {
  const document = createDefaultPaperDocument({ title: 'Managed library test' });
  usePaperStore.setState({
    documents: [{
      id: document.id,
      document,
      assetIds: [],
      selectedPageId: document.pages[0].id,
      selectedFrameIds: [],
      tool: 'select',
      zoom: 0.8,
    }],
    activeDocumentId: document.id,
    document,
    selectedPageId: document.pages[0].id,
    selectedFrameId: null,
    selectedFrameIds: [],
    tool: 'select',
    zoom: 0.8,
    undoStack: [],
    redoStack: [],
    documentHistories: {},
    clipboardFrames: [],
    styleClipboard: null,
    recovery: null,
    discardedDocumentRecoveries: [],
  });
}

describe('PaperFontImportControl managed Settings library', () => {
  let host: HTMLDivElement;
  let root: Root;
  let initialManagedLibrary: OpenFontLibraryFace[];

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    resetPaperStore();
    initialManagedLibrary = useSettingsStore.getState().openFontLibrary;
    useSettingsStore.setState({ openFontLibrary: [] });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    useSettingsStore.setState({ openFontLibrary: initialManagedLibrary });
  });

  it('adds a verified Settings face to the current Paper document, where the existing removal control can remove it', async () => {
    const face = managedLibraryFace();
    const registerManagedFace = vi.fn(async () => undefined);
    useSettingsStore.setState({ openFontLibrary: [face] });
    await act(async () => {
      root.render(<PaperFontImportControl registerManagedFace={registerManagedFace} />);
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>(`button[name="add-managed-font-${face.face.id}"]`)?.click();
    });
    await vi.waitFor(() => expect(registerManagedFace).toHaveBeenCalledWith(face.face));
    expect(usePaperStore.getState().document.importedFonts).toEqual([face.face]);
    expect(usePaperStore.getState().exportSnapshot().documents?.[0]?.document.importedFonts).toEqual([face.face]);
    expect(host.textContent).toContain('Select it from the Paper font menu to use it.');
    expect(host.textContent).toContain('In this document');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Remove Example Sans"]')?.click();
    });
    await vi.waitFor(() => expect(usePaperStore.getState().document.importedFonts).toEqual([]));
    expect(host.querySelector<HTMLButtonElement>(`button[name="add-managed-font-${face.face.id}"]`)).not.toBeNull();
  });

  it('leaves the document unchanged when the exact managed asset cannot register', async () => {
    const face = managedLibraryFace();
    const registerManagedFace = vi.fn(async () => { throw new Error('Exact bytes are unavailable'); });
    await act(async () => {
      root.render(<PaperFontImportControl managedLibrary={[face]} registerManagedFace={registerManagedFace} />);
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>(`button[name="add-managed-font-${face.face.id}"]`)?.click();
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Exact bytes are unavailable'));
    expect(usePaperStore.getState().document.importedFonts).toBeUndefined();
  });
});
