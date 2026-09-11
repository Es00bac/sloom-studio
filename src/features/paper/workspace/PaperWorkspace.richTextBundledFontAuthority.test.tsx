// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPaperDocument } from '../../../lib/paperDocument';
import { usePaperStore } from '../../../store/paperStore';
import type { PaperFrame, PaperImportedFont } from '../../../types/paper';
import { PaperRichEditableText } from './PaperWorkspace';
import { resolvePaperRichEditorTypographyUpdate } from './paperRichEditorSession';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  install: vi.fn(),
  showAlertDialog: vi.fn(async () => undefined),
  authorityCurrent: true,
  authority: { isCurrent: () => mocks.authorityCurrent },
  paper: {
    document: { importedFonts: undefined as PaperImportedFont[] | undefined },
    undoStack: [] as unknown[],
  },
}));

const bundledFamily = {
  id: 'base:authority', family: 'Authority Sans', slug: 'authority', collection: 'base', role: 'sans',
  sourceUrl: 'https://example.test', sourceVersion: '1', licenseId: 'OFL-1.1', licenseFile: 'LICENSE',
  licenseSha256: 'a'.repeat(64), licenseByteLength: 1, warnings: [], faces: [],
};
const bundledFace = {
  id: 'authority:regular', file: 'collection/base/authority/Regular.ttf', collectionIndex: 0,
  sha256: 'a'.repeat(64), byteLength: 3, family: 'Authority Sans', subfamily: 'Regular',
  fullName: 'Authority Sans Regular', postscriptName: 'AuthoritySans-Regular', version: '1', weight: 400,
  style: 'normal' as const, stretchPercent: 100, glyphCount: 1, variable: false, axes: {},
  canSubset: true, hasVerticalSubstitution: false,
};

const installedFace: PaperImportedFont = {
  id: 'bundled-authority:regular', familyId: 'authority', familyName: 'Authority Sans',
  postscriptName: 'AuthoritySans-Regular', weight: 400, style: 'normal', stretchPercent: 100,
  collectionIndex: 0, variableAxes: {}, unicodeRanges: [], format: 'truetype',
  fontAsset: { id: `sha256:${'a'.repeat(64)}`, sha256: 'a'.repeat(64), mimeType: 'font/ttf', byteLength: 3 },
  embeddability: 'installable', canSubset: true, source: { kind: 'bundled' }, license: {},
};

vi.mock('../../../components/Common/BundledFontBrowser', () => ({
  BundledFontBrowser: ({ onSelect }: { onSelect: (family: typeof bundledFamily, face: typeof bundledFace, authority: typeof mocks.authority) => void | Promise<void> }) => (
    <button onClick={() => void onSelect(bundledFamily, bundledFace, mocks.authority)} type="button">Choose authority font</button>
  ),
}));

vi.mock('../../../lib/bundledFontLibrary', () => ({
  installBundledPaperFontFace: mocks.install,
}));

vi.mock('./PaperFontImport', () => ({
  ensurePaperImportedFontRegistered: mocks.authenticate,
}));

vi.mock('../assets/PaperAssetRuntime', () => ({ paperAssetRepository: {} }));

vi.mock('../../../store/alertDialogStore', () => ({ showAlertDialog: mocks.showAlertDialog }));

vi.mock('../../../store/paperStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store/paperStore')>();
  const addImportedFont = (font: PaperImportedFont) => {
    mocks.paper.document.importedFonts = [font];
  };
  const state = () => ({ document: mocks.paper.document, undoStack: mocks.paper.undoStack, addImportedFont });
  const usePaperStoreMock = <T,>(selector: (current: ReturnType<typeof state>) => T) => selector(state());
  usePaperStoreMock.getState = state;
  return { ...actual, usePaperStore: usePaperStoreMock };
});

function richFrame(): PaperFrame {
  const document = createDefaultPaperDocument({ title: 'Authority test' });
  return {
    id: 'authority-frame', kind: 'text', label: 'Authority frame', xMm: 0, yMm: 0, widthMm: 60, heightMm: 20,
    rotationDeg: 0, locked: false, fit: 'cover', imageScale: 1, imageOffsetXPercent: 0, imageOffsetYPercent: 0,
    imageRotationDeg: 0, columns: 1, typography: document.pages[0].frames[0]?.typography ?? {
      fontFamily: 'Inter', fontWeight: '400', fontStyle: 'normal', fontStretch: '100%', fontSizePt: 12,
      leadingPt: 14, tracking: 0, align: 'left', hyphenate: false, color: '#111111',
    }, fillColor: 'transparent', fillOpacity: 0, strokeColor: 'transparent', strokeOpacity: 0, strokeWidthMm: 0,
    strokeStyle: 'solid', cornerRadiusMm: 0, opacity: 1, textBoxXPercent: 0, textBoxYPercent: 0,
    textBoxWidthPercent: 100, textBoxHeightPercent: 100, textRotationDeg: 0, textVerticalAlign: 'top', zIndex: 1,
    text: 'Current rich text', richText: [{ runs: [{ text: 'Current rich text' }] }],
  };
}

describe('Paper rich bundled-font selection authority (FBL-025)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn() } });
    mocks.paper.document.importedFonts = undefined;
    // This is deliberately non-empty: stale bundled selections must not rewrite real history that predates
    // the selection, not merely an empty test store.
    mocks.paper.undoStack = [{ kind: 'real-history-baseline' }];
    mocks.authorityCurrent = true;
    mocks.install.mockReset();
    mocks.authenticate.mockReset();
    mocks.showAlertDialog.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    mocks.authenticate.mockReset();
    mocks.install.mockReset();
    vi.unstubAllGlobals();
  });

  function render(frame: PaperFrame, onCommit = vi.fn()) {
    act(() => {
      root.render(
        <PaperRichEditableText
          baseStyle={{}}
          className="authority-editor"
          frame={frame}
          managedFonts={undefined}
          onCancel={vi.fn()}
          onCommit={onCommit}
          zoom={1}
        />,
      );
    });
    return onCommit;
  }

  async function openBundledFontMenu() {
    await act(async () => {
      await vi.waitFor(() => expect(document.body.querySelector<HTMLButtonElement>('button[title="Audited font library"]')).not.toBeNull());
    });
    await act(async () => document.body.querySelector<HTMLButtonElement>('button[title="Audited font library"]')?.click());
    await act(async () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Choose authority font')?.click());
  }

  it('publishes no stale rich DOM, document/history, or notice when replacement revokes authority during authentication', async () => {
    let releaseAuthentication: (() => void) | undefined;
    mocks.install.mockResolvedValue(installedFace);
    mocks.authenticate.mockImplementation(() => new Promise<void>((resolve) => { releaseAuthentication = resolve; }));
    const original = richFrame();
    const onCommit = render(original);

    await openBundledFontMenu();
    await act(async () => {
      await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(installedFace));
    });
    const editor = container.querySelector<HTMLElement>('[role="textbox"]')!;
    const domBeforeRelease = editor.innerHTML;
    const documentBeforeRelease = structuredClone(usePaperStore.getState().document);
    const historyBeforeRelease = structuredClone(usePaperStore.getState().undoStack);

    mocks.authorityCurrent = false;
    render({ ...original, typography: { ...original.typography, fontFamily: 'Replacement Sans', fontStyle: 'italic', fontWeight: '700' } }, onCommit);
    await act(async () => releaseAuthentication?.());

    expect(editor.innerHTML).toBe(domBeforeRelease);
    expect(usePaperStore.getState().document).toEqual(documentBeforeRelease);
    expect(usePaperStore.getState().undoStack).toEqual(historyBeforeRelease);
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Choose authority font');
    expect(document.body.textContent).not.toContain('pinned to this document');
  });

  it('publishes one current authorized rich typography selection after authentication', async () => {
    mocks.install.mockResolvedValue(installedFace);
    mocks.authenticate.mockResolvedValue(undefined);
    render(richFrame());

    await openBundledFontMenu();
    await act(async () => {
      await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(installedFace));
    });

    const editor = container.querySelector<HTMLElement>('[role="textbox"]')!;
    expect(editor.innerHTML).toContain('Authority Sans');
    expect(editor.querySelectorAll('[data-paper-font-family="Authority Sans"]')).toHaveLength(1);
    expect(usePaperStore.getState().document.importedFonts).toEqual([installedFace]);
    expect(mocks.install).toHaveBeenCalledTimes(1);
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('Choose authority font');
  });

  it('carries the transient exact face and the same authority through the Inspector live-editor session await', async () => {
    let releaseAuthentication: (() => void) | undefined;
    mocks.authenticate.mockImplementation(() => new Promise<void>((resolve) => { releaseAuthentication = resolve; }));
    const original = richFrame();
    render(original);
    const editor = container.querySelector<HTMLElement>('[role="textbox"]')!;
    const domBeforeRelease = editor.innerHTML;
    const next = { ...original.typography, fontFamily: bundledFamily.family };
    let pending: ReturnType<typeof resolvePaperRichEditorTypographyUpdate> | undefined;

    await act(async () => {
      pending = resolvePaperRichEditorTypographyUpdate(
        original.id,
        original.typography,
        next,
        original.richText,
        { authority: mocks.authority, managedFonts: [installedFace] },
      );
      await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(installedFace));
    });

    mocks.authorityCurrent = false;
    render({ ...original, typography: { ...original.typography, fontFamily: 'Replacement Sans' } });
    await act(async () => releaseAuthentication?.());
    await pending;

    expect(editor.innerHTML).toBe(domBeforeRelease);
    expect(usePaperStore.getState().document.importedFonts).toBeUndefined();
    expect(usePaperStore.getState().undoStack).toEqual([{ kind: 'real-history-baseline' }]);
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
  });

  it('publishes no stale rich error, document/history, or menu mutation when pending authentication rejects', async () => {
    let rejectAuthentication: ((error: Error) => void) | undefined;
    mocks.install.mockResolvedValue(installedFace);
    mocks.authenticate.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectAuthentication = reject; }));
    const original = richFrame();
    const onCommit = render(original);

    await openBundledFontMenu();
    await act(async () => {
      await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledWith(installedFace));
    });
    const editor = container.querySelector<HTMLElement>('[role="textbox"]')!;
    const domBeforeRejection = editor.innerHTML;
    const documentBeforeRejection = structuredClone(usePaperStore.getState().document);
    const historyBeforeRejection = structuredClone(usePaperStore.getState().undoStack);

    mocks.authorityCurrent = false;
    render({ ...original, typography: { ...original.typography, fontFamily: 'Replacement Sans' } }, onCommit);
    await act(async () => rejectAuthentication?.(new Error('stale rich authentication failure')));

    expect(editor.innerHTML).toBe(domBeforeRejection);
    expect(usePaperStore.getState().document).toEqual(documentBeforeRejection);
    expect(usePaperStore.getState().undoStack).toEqual(historyBeforeRejection);
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Choose authority font');
    expect(document.body.textContent).not.toContain('pinned to this document');
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
  });

  it('retains the current rich rejection alert without DOM, font, history, menu, or notice publication', async () => {
    mocks.install.mockResolvedValue(installedFace);
    mocks.authenticate.mockRejectedValue(new Error('current rich authentication failure'));
    const original = richFrame();
    const onCommit = render(original);
    const editor = container.querySelector<HTMLElement>('[role="textbox"]')!;
    const domBeforeRejection = editor.innerHTML;
    const documentBeforeRejection = structuredClone(usePaperStore.getState().document);
    const historyBeforeRejection = structuredClone(usePaperStore.getState().undoStack);

    await openBundledFontMenu();
    await act(async () => {
      await vi.waitFor(() => expect(mocks.showAlertDialog).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Exact Font Edit Blocked',
        message: 'current rich authentication failure',
      })));
    });

    expect(editor.innerHTML).toBe(domBeforeRejection);
    expect(usePaperStore.getState().document).toEqual(documentBeforeRejection);
    expect(usePaperStore.getState().undoStack).toEqual(historyBeforeRejection);
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Choose authority font');
    expect(document.body.textContent).not.toContain('pinned to this document');
  });
});
