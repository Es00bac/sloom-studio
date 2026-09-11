// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPaperDocument, DEFAULT_PAPER_TYPOGRAPHY } from '../../../lib/paperDocument';
import { registerPaperRichEditorSession } from './paperRichEditorSession';
import { usePaperStore } from '../../../store/paperStore';
import type { PaperDocument, PaperFrame, PaperImportedFont } from '../../../types/paper';
import { PaperInspector } from './PaperWorkspace';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  install: vi.fn(),
  sessionCommit: vi.fn(),
  showAlertDialog: vi.fn(async () => undefined),
  authority: { isCurrent: () => true },
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

const bundledFamily = {
  id: 'base:inspector-authority', family: 'Inspector Authority Sans', slug: 'inspector-authority', collection: 'base', role: 'sans',
  sourceUrl: 'https://example.test', sourceVersion: '1', licenseId: 'OFL-1.1', licenseFile: 'LICENSE',
  licenseSha256: 'a'.repeat(64), licenseByteLength: 1, warnings: [], faces: [],
};
const bundledFace = {
  id: 'inspector-authority:regular', file: 'collection/base/inspector-authority/Regular.ttf', collectionIndex: 0,
  sha256: 'a'.repeat(64), byteLength: 3, family: bundledFamily.family, subfamily: 'Regular',
  fullName: 'Inspector Authority Sans Regular', postscriptName: 'InspectorAuthoritySans-Regular', version: '1', weight: 400,
  style: 'normal' as const, stretchPercent: 100, glyphCount: 1, variable: false, axes: {},
  canSubset: true, hasVerticalSubstitution: false,
};
const installedFace: PaperImportedFont = {
  id: 'bundled-inspector-authority:regular', familyId: 'inspector-authority', familyName: bundledFamily.family,
  postscriptName: bundledFace.postscriptName, weight: 400, style: 'normal', stretchPercent: 100,
  collectionIndex: 0, variableAxes: {}, unicodeRanges: [], format: 'truetype',
  fontAsset: { id: `sha256:${'a'.repeat(64)}`, sha256: 'a'.repeat(64), mimeType: 'font/ttf', byteLength: 3 },
  embeddability: 'installable', canSubset: true, source: { kind: 'bundled' }, license: {},
};

vi.mock('../../../components/Common/BundledFontBrowser', () => ({
  BundledFontBrowser: ({ onSelect }: { onSelect: (family: typeof bundledFamily, face: typeof bundledFace, authority: typeof mocks.authority) => void | Promise<void> }) => (
    <button onClick={() => void onSelect(bundledFamily, bundledFace, mocks.authority)} type="button">Choose inspector authority font</button>
  ),
}));
vi.mock('../../../lib/bundledFontLibrary', () => ({ installBundledPaperFontFace: mocks.install }));
vi.mock('./PaperFontImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PaperFontImport')>();
  return { ...actual, ensurePaperImportedFontRegistered: mocks.authenticate };
});
vi.mock('../assets/PaperAssetRuntime', () => ({ paperAssetRepository: {} }));
vi.mock('../../../store/alertDialogStore', () => ({ showAlertDialog: mocks.showAlertDialog }));

function makeDocument(title: string, text: string, ids = { document: 'authority-document', page: 'authority-page', frame: 'authority-frame' }): PaperDocument {
  const document = createDefaultPaperDocument({ title });
  document.id = ids.document;
  document.pages[0].id = ids.page;
  document.pages[0].frames[0] = {
    id: ids.frame,
    kind: 'text',
    label: 'Inspector authority frame',
    xMm: 0,
    yMm: 0,
    widthMm: 60,
    heightMm: 20,
    rotationDeg: 0,
    locked: false,
    fit: 'cover',
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    columns: 1,
    typography: DEFAULT_PAPER_TYPOGRAPHY,
    fillColor: 'transparent',
    fillOpacity: 0,
    strokeColor: 'transparent',
    strokeOpacity: 0,
    strokeWidthMm: 0,
    strokeStyle: 'solid',
    cornerRadiusMm: 0,
    opacity: 1,
    textBoxXPercent: 0,
    textBoxYPercent: 0,
    textBoxWidthPercent: 100,
    textBoxHeightPercent: 100,
    textRotationDeg: 0,
    textVerticalAlign: 'top',
    zIndex: 1,
    text,
    richText: [{ runs: [{ text }] }],
  } as PaperFrame;
  return document;
}

function setStore(document: PaperDocument) {
  const pageId = document.pages[0].id;
  const frameId = document.pages[0].frames[0].id;
  usePaperStore.setState({
    activeDocumentId: document.id,
    document,
    selectedPageId: pageId,
    selectedFrameId: frameId,
    selectedFrameIds: [frameId],
    undoStack: [],
    redoStack: [],
  });
}

describe('Paper Inspector bundled-font selection authority (FBL-025)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.install.mockReset();
    mocks.authenticate.mockReset();
    mocks.sessionCommit.mockReset();
    mocks.showAlertDialog.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.querySelectorAll('[data-fbl025-live-editor]').forEach((editor) => editor.remove());
    vi.unstubAllGlobals();
  });

  function render(document: PaperDocument, mountedPublication = false, mountedTrackChanges = false) {
    const page = document.pages[0];
    act(() => {
      root.render(
        <PaperInspector
          canPasteStyle={false}
          document={document}
          documentTitle={document.title}
          frame={page.frames[0]}
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
          onUpdateDocumentSetup={vi.fn()}
          onUpdatePublicationReferences={usePaperStore.getState().updatePaperPublicationReferences}
          onUpdatePaperTrackChanges={mountedTrackChanges ? usePaperStore.getState().updatePaperTrackChanges : vi.fn()}
          onDecidePaperTrackChange={mountedTrackChanges ? usePaperStore.getState().decidePaperTrackChange : vi.fn()}
          onUpdateStyleAutomation={vi.fn()}
          onUpdateFrame={mountedPublication ? usePaperStore.getState().updateSelectedFrame : vi.fn()}
          pageCount={1}
          selectedPageNumber={1}
          status=""
        />,
      );
    });
  }

  it('does not publish an installed font or mutate replacement B while A exact-face authentication is pending', async () => {
    let releaseAuthentication: (() => void) | undefined;
    mocks.install.mockResolvedValue(installedFace);
    mocks.authenticate.mockImplementation(() => new Promise<void>((resolve) => { releaseAuthentication = resolve; }));
    const a = makeDocument('A', 'A rich text');
    const b = makeDocument('B', 'B replacement text');
    setStore(a);
    const unregister = registerPaperRichEditorSession(a.pages[0].frames[0].id, {
      applyTypography: async (_previous, _next, context) => {
        await mocks.authenticate(context?.managedFonts?.at(-1));
        if (!context?.authority?.isCurrent()) return null;
        mocks.sessionCommit('A rich text');
        return { text: 'A rich text', richText: [{ runs: [{ text: 'A rich text' }] }] };
      },
    });
    render(a);

    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Choose inspector authority font')?.click());
    await act(async () => {
      await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledTimes(1));
    });
    const importedBefore = structuredClone(usePaperStore.getState().document.importedFonts);
    const historyBefore = structuredClone(usePaperStore.getState().undoStack);
    expect(importedBefore).toBeUndefined();
    expect(historyBefore).toEqual([]);

    setStore(b);
    render(b);
    await act(async () => releaseAuthentication?.());

    expect(usePaperStore.getState().document).toBe(b);
    expect(usePaperStore.getState().document.importedFonts).toEqual(importedBefore);
    expect(usePaperStore.getState().undoStack).toEqual(historyBefore);
    expect(usePaperStore.getState().document.pages[0].frames[0].typography.fontFamily).not.toBe(bundledFamily.family);
    expect(mocks.sessionCommit).not.toHaveBeenCalled();
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
    unregister();
  });

  it('suppresses a stale authentication rejection after same-ID replacement without an obsolete error or mutation', async () => {
    let rejectAuthentication: ((error: Error) => void) | undefined;
    mocks.install.mockResolvedValue(installedFace);
    mocks.authenticate.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectAuthentication = reject; }));
    const a = makeDocument('A', 'A rich text');
    // Same document/page/frame IDs are intentional: identity and generation, not names, own the operation.
    const replacement = makeDocument('A replacement', 'Replacement with the same IDs');
    setStore(a);
    const unregister = registerPaperRichEditorSession(a.pages[0].frames[0].id, {
      applyTypography: async (_previous, _next, context) => {
        await mocks.authenticate(context?.managedFonts?.at(-1));
        if (!context?.authority?.isCurrent()) return null;
        mocks.sessionCommit('A rich text');
        return { text: 'A rich text', richText: [{ runs: [{ text: 'A rich text' }] }] };
      },
    });
    render(a);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Choose inspector authority font')?.click());
    await act(async () => { await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledTimes(1)); });
    const historyBefore = structuredClone(usePaperStore.getState().undoStack);

    setStore(replacement);
    render(replacement);
    await act(async () => rejectAuthentication?.(new Error('A authentication failed')));

    expect(usePaperStore.getState().document).toBe(replacement);
    expect(usePaperStore.getState().document.importedFonts).toBeUndefined();
    expect(usePaperStore.getState().undoStack).toEqual(historyBefore);
    expect(mocks.sessionCommit).not.toHaveBeenCalled();
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
    unregister();
  });

  it('revokes a live-editor commit when the same-ID store target is replaced without an Inspector rerender', async () => {
    let releaseAuthentication: (() => void) | undefined;
    mocks.install.mockResolvedValue(installedFace);
    mocks.authenticate.mockImplementation(() => new Promise<void>((resolve) => { releaseAuthentication = resolve; }));
    const a = makeDocument('A', 'A rich text');
    const replacement = makeDocument('A replacement', 'Replacement with the same IDs');
    const liveEditor = document.createElement('div');
    liveEditor.dataset.fbl025LiveEditor = 'true';
    liveEditor.textContent = 'A uncontrolled rich DOM';
    document.body.append(liveEditor);
    setStore(a);
    const unregister = registerPaperRichEditorSession(a.pages[0].frames[0].id, {
      applyTypography: async (_previous, _next, context) => {
        await mocks.authenticate(context?.managedFonts?.at(-1));
        if (!context?.authority?.isCurrent()) return null;
        mocks.sessionCommit('stale A rich text');
        liveEditor.textContent = 'stale A rich DOM mutation';
        return { text: 'stale A rich text', richText: [{ runs: [{ text: 'stale A rich text' }] }] };
      },
    });
    render(a);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Choose inspector authority font')?.click());
    await act(async () => { await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(installedFace)); });
    const historyBefore = structuredClone(usePaperStore.getState().undoStack);

    // Do not rerender the mounted Inspector. Its React props and selection generation still describe A,
    // while the live Paper store has been replaced by different same-ID document/page/frame objects.
    setStore(replacement);
    await act(async () => releaseAuthentication?.());

    expect(liveEditor.textContent).toBe('A uncontrolled rich DOM');
    expect(mocks.sessionCommit).not.toHaveBeenCalled();
    expect(usePaperStore.getState().document).toBe(replacement);
    expect(usePaperStore.getState().document.importedFonts).toBeUndefined();
    expect(usePaperStore.getState().document.pages[0].frames[0].typography.fontFamily).not.toBe(bundledFamily.family);
    expect(usePaperStore.getState().undoStack).toEqual(historyBefore);
    expect(host.textContent).not.toContain('pinned to this document');
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
    unregister();
  });

  it('cannot revive a pending Inspector operation after unmount and remount', async () => {
    let releaseAuthentication: (() => void) | undefined;
    mocks.install.mockResolvedValue(installedFace);
    mocks.authenticate.mockImplementation(() => new Promise<void>((resolve) => { releaseAuthentication = resolve; }));
    const a = makeDocument('A', 'A rich text');
    const remounted = makeDocument('Remounted', 'Remounted replacement');
    setStore(a);
    const unregister = registerPaperRichEditorSession(a.pages[0].frames[0].id, {
      applyTypography: async (_previous, _next, context) => {
        await mocks.authenticate(context?.managedFonts?.at(-1));
        if (!context?.authority?.isCurrent()) return null;
        mocks.sessionCommit('A rich text');
        return { text: 'A rich text', richText: [{ runs: [{ text: 'A rich text' }] }] };
      },
    });
    render(a);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Choose inspector authority font')?.click());
    await act(async () => { await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledTimes(1)); });
    await act(async () => root.unmount());
    root = createRoot(host);
    setStore(remounted);
    render(remounted);
    await act(async () => releaseAuthentication?.());

    expect(usePaperStore.getState().document).toBe(remounted);
    expect(usePaperStore.getState().document.importedFonts).toBeUndefined();
    expect(usePaperStore.getState().undoStack).toEqual([]);
    expect(mocks.sessionCommit).not.toHaveBeenCalled();
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
    unregister();
  });

  it('does not revive A after an A to B to A Inspector generation cycle', async () => {
    let releaseAuthentication: (() => void) | undefined;
    mocks.install.mockResolvedValue(installedFace);
    mocks.authenticate.mockImplementation(() => new Promise<void>((resolve) => { releaseAuthentication = resolve; }));
    const a = makeDocument('A', 'Original A rich text');
    const b = makeDocument('B', 'B replacement with the same IDs');
    setStore(a);
    const unregister = registerPaperRichEditorSession(a.pages[0].frames[0].id, {
      applyTypography: async (_previous, _next, context) => {
        await mocks.authenticate(context?.managedFonts?.at(-1));
        if (!context?.authority?.isCurrent()) return null;
        mocks.sessionCommit('revived A');
        return { text: 'revived A', richText: [{ runs: [{ text: 'revived A' }] }] };
      },
    });
    render(a);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Choose inspector authority font')?.click());
    await act(async () => { await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(installedFace)); });

    setStore(b);
    render(b);
    setStore(a);
    render(a);
    const historyBefore = structuredClone(usePaperStore.getState().undoStack);
    await act(async () => releaseAuthentication?.());

    expect(usePaperStore.getState().document).toBe(a);
    expect(usePaperStore.getState().document.importedFonts).toBeUndefined();
    expect(usePaperStore.getState().document.pages[0].frames[0].typography.fontFamily).not.toBe(bundledFamily.family);
    expect(usePaperStore.getState().undoStack).toEqual(historyBefore);
    expect(mocks.sessionCommit).not.toHaveBeenCalled();
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
    unregister();
  });

  it('cannot revive the exact original A object after an unrendered store A to B to A cycle', async () => {
    let releaseAuthentication: (() => void) | undefined;
    mocks.install.mockResolvedValue(installedFace);
    mocks.authenticate.mockImplementation(() => new Promise<void>((resolve) => { releaseAuthentication = resolve; }));
    const a = makeDocument('A', 'Original A rich text');
    const b = makeDocument('B', 'B replacement with the same IDs');
    const liveEditor = document.createElement('div');
    liveEditor.dataset.fbl025LiveEditor = 'true';
    liveEditor.textContent = 'Original A rich DOM';
    document.body.append(liveEditor);
    setStore(a);
    const unregister = registerPaperRichEditorSession(a.pages[0].frames[0].id, {
      applyTypography: async (_previous, _next, context) => {
        await mocks.authenticate(context?.managedFonts?.at(-1));
        if (!context?.authority?.isCurrent()) return null;
        mocks.sessionCommit('revived exact A');
        liveEditor.textContent = 'revived exact A rich DOM';
        return { text: 'revived exact A', richText: [{ runs: [{ text: 'revived exact A' }] }] };
      },
    });
    render(a);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Choose inspector authority font')?.click());
    await act(async () => { await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(installedFace)); });

    // React may batch away both external transitions. The Inspector props, its local generation, and
    // all final object identities therefore look exactly current again unless the store records that
    // authority left A in between.
    act(() => {
      setStore(b);
      setStore(a);
    });
    const historyBefore = structuredClone(usePaperStore.getState().undoStack);
    await act(async () => releaseAuthentication?.());

    expect(liveEditor.textContent).toBe('Original A rich DOM');
    expect(usePaperStore.getState().document).toBe(a);
    expect(usePaperStore.getState().document.importedFonts).toBeUndefined();
    expect(usePaperStore.getState().document.pages[0].frames[0].typography.fontFamily).not.toBe(bundledFamily.family);
    expect(usePaperStore.getState().undoStack).toEqual(historyBefore);
    expect(mocks.sessionCommit).not.toHaveBeenCalled();
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
    unregister();
  });

  it('suppresses the success notice when a no-live-editor commit loses the store target', async () => {
    let resolveInstall: ((font: PaperImportedFont) => void) | undefined;
    mocks.install.mockImplementation(() => new Promise<PaperImportedFont>((resolve) => { resolveInstall = resolve; }));
    const a = makeDocument('A', 'A without a live editor');
    const replacement = makeDocument('Replacement', 'Store replacement with the same IDs');
    setStore(a);
    render(a);

    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Choose inspector authority font')?.click());
    await act(async () => { await vi.waitFor(() => expect(mocks.install).toHaveBeenCalledTimes(1)); });
    // Leave the mounted Inspector props untouched so its operation authority is still current, but replace
    // the actual store target. The synchronous fallback must propagate the store commit's false result.
    setStore(replacement);
    await act(async () => resolveInstall?.(installedFace));

    expect(usePaperStore.getState().document).toBe(replacement);
    expect(usePaperStore.getState().document.importedFonts).toBeUndefined();
    expect(usePaperStore.getState().document.pages[0].frames[0].typography.fontFamily).not.toBe(bundledFamily.family);
    expect(usePaperStore.getState().undoStack).toEqual([]);
    expect(host.textContent).not.toContain('pinned to this document');
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
  });

  it('retains current no-live-editor commit and success-notice behavior', async () => {
    mocks.install.mockResolvedValue(installedFace);
    const a = makeDocument('A', 'A without a live editor');
    setStore(a);
    render(a);

    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Choose inspector authority font')?.click());
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('pinned to this document'));
    });

    expect(usePaperStore.getState().document.importedFonts).toEqual([installedFace]);
    expect(usePaperStore.getState().document.pages[0].frames[0].typography.fontFamily).toBe(bundledFamily.family);
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
  });

  it('commits each current Inspector selection exactly once to its exact target', async () => {
    mocks.install.mockResolvedValueOnce({ ...installedFace, id: 'installed-first' }).mockResolvedValueOnce({ ...installedFace, id: 'installed-second' });
    mocks.authenticate.mockResolvedValue(undefined);
    const a = makeDocument('A', 'A rich text');
    setStore(a);
    const unregister = registerPaperRichEditorSession(a.pages[0].frames[0].id, {
      applyTypography: async (_previous, _next, context) => {
        await mocks.authenticate(context?.managedFonts?.at(-1));
        if (!context?.authority?.isCurrent()) return null;
        mocks.sessionCommit('A rich text');
        return { text: 'A rich text', richText: [{ runs: [{ text: 'A rich text' }] }] };
      },
    });
    render(a);
    const choose = async () => act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Choose inspector authority font')?.click());
    await choose();
    await act(async () => { await vi.waitFor(() => expect(usePaperStore.getState().undoStack).toHaveLength(1)); });
    expect(usePaperStore.getState().document.importedFonts?.map((font) => font.id)).toEqual(['installed-first']);
    expect(usePaperStore.getState().document.pages[0].frames[0].typography.fontFamily).toBe(bundledFamily.family);
    expect(mocks.sessionCommit).toHaveBeenCalledTimes(1);

    const current = usePaperStore.getState().document;
    render(current);
    await choose();
    await act(async () => { await vi.waitFor(() => expect(usePaperStore.getState().undoStack).toHaveLength(2)); });
    expect(usePaperStore.getState().document.importedFonts?.map((font) => font.id)).toEqual(['installed-second']);
    expect(mocks.authenticate).toHaveBeenCalledTimes(2);
    expect(mocks.sessionCommit).toHaveBeenCalledTimes(2);
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
    unregister();
  });

  it('retains the established alert and zero-history behavior for a current authentication rejection', async () => {
    mocks.install.mockResolvedValue(installedFace);
    mocks.authenticate.mockRejectedValue(new Error('current exact face rejected'));
    const a = makeDocument('A', 'A rich text');
    setStore(a);
    const historyBefore = structuredClone(usePaperStore.getState().undoStack);
    const unregister = registerPaperRichEditorSession(a.pages[0].frames[0].id, {
      applyTypography: async (_previous, _next, context) => {
        await mocks.authenticate(context?.managedFonts?.at(-1));
        if (!context?.authority?.isCurrent()) return null;
        mocks.sessionCommit('should not commit');
        return { text: 'should not commit', richText: [{ runs: [{ text: 'should not commit' }] }] };
      },
    });
    render(a);
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Choose inspector authority font')?.click());
    await act(async () => {
      await vi.waitFor(() => expect(mocks.showAlertDialog).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Exact Font Edit Blocked',
        message: 'current exact face rejected',
      })));
    });

    expect(usePaperStore.getState().document).toBe(a);
    expect(usePaperStore.getState().document.importedFonts).toBeUndefined();
    expect(usePaperStore.getState().undoStack).toEqual(historyBefore);
    expect(mocks.sessionCommit).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('pinned to this document');
    unregister();
  });

  it('mounts publication reference authoring and inserts a durable page token', () => {
    const document = makeDocument('Publication', 'Body');
    setStore(document);
    render(document, true);
    const add = host.querySelector<HTMLButtonElement>('[data-testid="publication-add-toc"]');
    expect(add).toBeDefined();
    act(() => add?.click());
    const entry = usePaperStore.getState().document.publicationReferences?.tocEntries[0];
    expect(entry).toMatchObject({ label: 'New entry', targetPageId: document.pages[0].id });
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
    render(usePaperStore.getState().document, true);
    const token = host.querySelector<HTMLButtonElement>(`button[aria-label="Insert page token ${entry?.id}"]`);
    act(() => token?.click());
    expect(usePaperStore.getState().document.pages[0].frames[0].text).toContain(`{{page:${entry?.id}}}`);
    expect(usePaperStore.getState().undoStack).toHaveLength(2);
  });

  it('mounts track-change recording and accepts a revision through document history', () => {
    const paper = makeDocument('Redline', 'Before');
    setStore(paper);
    render(paper, false, true);
    const section = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Track changes & redlining'));
    expect(section).toBeDefined();
    act(() => section?.click());
    const proposed = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Track change proposed text"]');
    expect(proposed).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(proposed, 'After');
      proposed?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Record revision')?.click());
    expect(usePaperStore.getState().document.trackChanges).toHaveLength(1);
    expect(usePaperStore.getState().document.trackChanges?.[0].status).toBe('pending');
    expect(usePaperStore.getState().undoStack).toHaveLength(1);

    render(usePaperStore.getState().document, false, true);
    act(() => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Accept')?.click());
    expect(usePaperStore.getState().document.pages[0].frames[0].text).toBe('After');
    expect(usePaperStore.getState().document.trackChanges?.[0].status).toBe('accepted');
    expect(usePaperStore.getState().undoStack).toHaveLength(2);
    act(() => usePaperStore.getState().undo());
    expect(usePaperStore.getState().document.pages[0].frames[0].text).toBe('Before');
    expect(usePaperStore.getState().document.trackChanges?.[0].status).toBe('pending');
    act(() => usePaperStore.getState().redo());
    expect(usePaperStore.getState().document.pages[0].frames[0].text).toBe('After');
    expect(usePaperStore.getState().document.trackChanges?.[0].status).toBe('accepted');
  });
});
