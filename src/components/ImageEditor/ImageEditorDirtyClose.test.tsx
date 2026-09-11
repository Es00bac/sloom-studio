// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { useSourceBinStore } from '../../store/sourceBinStore';
import type { ImageDocument } from '../../types/imageEditor';
import { ImageEditorAssetBar } from './ImageEditorAssetBar';
import { installDirtyImageDocumentUnloadGuard } from './ImageDocumentClose';
import { ImageEditorTabs } from './ImageEditorTabs';

vi.mock('./ImageSlimgCodec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ImageSlimgCodec')>();
  return {
    ...actual,
    saveImageDocumentAsSlimg: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
});

vi.mock('./ImageDocumentExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ImageDocumentExport')>();
  return {
    ...actual,
    imageDocumentToDataUrl: vi.fn(async () => 'data:image/png;base64,AAAA'),
  };
});

function dirtyDocument(overrides: Partial<ImageDocument> = {}): ImageDocument {
  return {
    ...createEmptyImageDocument({
      id: 'dirty-doc',
      title: 'Layered artwork',
      width: 32,
      height: 24,
    }),
    dirty: true,
    hasSelection: true,
    selectionVersion: 4,
    selectionMask: {
      width: 32,
      height: 24,
      data: new Uint8ClampedArray(32 * 24).fill(255),
    },
    ...overrides,
  };
}

describe('Image Editor dirty document close contract', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
      generativeFillDismissedByDocId: {},
    });
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', items: [], collapsed: false, createdAt: 1 }],
    });
    delete window.signalLoomNative;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderTabs(): void {
    act(() => root.render(<ImageEditorTabs />));
  }

  async function clickClose(): Promise<void> {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label^="Close"]')?.click();
      await Promise.resolve();
    });
  }

  async function choose(label: string): Promise<void> {
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === label)
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function expectDocumentPreserved(): void {
    const state = useImageEditorStore.getState();
    expect(state.documents).toHaveLength(1);
    expect(state.documents[0]).toMatchObject({
      id: 'dirty-doc',
      dirty: true,
      hasSelection: true,
      selectionVersion: 4,
    });
    expect(state.activeDocId).toBe('dirty-doc');
    expect(state.undoStacks['dirty-doc']).toHaveLength(1);
    expect(state.redoStacks['dirty-doc']).toHaveLength(1);
  }

  function openDirtyDocument(overrides: Partial<ImageDocument> = {}): void {
    useImageEditorStore.getState().openDocument(dirtyDocument(overrides));
    useImageEditorStore.getState().pushOperation({
      kind: 'selection',
      docId: 'dirty-doc',
      before: null,
      after: null,
    });
    useImageEditorStore.setState((state) => ({
      redoStacks: {
        ...state.redoStacks,
        'dirty-doc': [{ kind: 'selection', docId: 'dirty-doc', before: null, after: null }],
      },
    }));
  }

  it('closes a clean document directly without showing a decision dialog', async () => {
    useImageEditorStore.getState().openDocument(createEmptyImageDocument({
      id: 'clean-doc',
      title: 'Saved artwork',
      width: 8,
      height: 8,
    }));
    renderTabs();

    await clickClose();

    expect(useImageEditorStore.getState().documents).toHaveLength(0);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('saves through the native editable-document path before closing', async () => {
    const saveImageDocumentFileAs = vi.fn(async () => ({ canceled: false, path: '/tmp/layered.slimg' }));
    window.signalLoomNative = { saveImageDocumentFileAs } as never;
    openDirtyDocument();
    renderTabs();

    await clickClose();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await choose('Save');

    expect(saveImageDocumentFileAs).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(useImageEditorStore.getState().documents).toHaveLength(0);
    expect(useImageEditorStore.getState().undoStacks['dirty-doc']).toBeUndefined();
    expect(useImageEditorStore.getState().redoStacks['dirty-doc']).toBeUndefined();
  });

  it.each([
    ['cancelled', async () => ({ canceled: true })],
    ['failed', async () => { throw new Error('disk full'); }],
  ])('keeps the document, selection, and both histories when native Save is %s', async (_label, saveImpl) => {
    window.signalLoomNative = { saveImageDocumentFileAs: vi.fn(saveImpl) } as never;
    openDirtyDocument();
    renderTabs();

    await clickClose();
    await choose('Save');

    expectDocumentPreserved();
  });

  it('discards only after the explicit Discard decision', async () => {
    openDirtyDocument();
    renderTabs();

    await clickClose();
    await choose('Discard');

    expect(useImageEditorStore.getState().documents).toHaveLength(0);
    expect(useImageEditorStore.getState().undoStacks['dirty-doc']).toBeUndefined();
    expect(useImageEditorStore.getState().redoStacks['dirty-doc']).toBeUndefined();
  });

  it('revalidates an externally saved document before a stale Discard decision', async () => {
    const openWorkspaceWindow = vi.fn(async () => undefined);
    window.signalLoomNative = { openWorkspaceWindow } as never;
    openDirtyDocument({ linkedEdit: { kind: 'slimg-node', filePath: '/tmp/flow-edit.slimg' } });
    renderTabs();

    await clickClose();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    const discardDocument = vi.spyOn(useImageEditorStore.getState(), 'discardDocument');
    act(() => useImageEditorStore.getState().markDocumentClean('dirty-doc'));
    expect(useImageEditorStore.getState().documents[0]?.dirty).toBe(false);

    await choose('Discard');

    expect(discardDocument).not.toHaveBeenCalled();
    expect(useImageEditorStore.getState().documents).toHaveLength(0);
    expect(useImageEditorStore.getState().undoStacks['dirty-doc']).toBeUndefined();
    expect(useImageEditorStore.getState().redoStacks['dirty-doc']).toBeUndefined();
    expect(openWorkspaceWindow).toHaveBeenCalledWith('flow');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('preserves the active dirty document, selection, and histories on Cancel and Escape', async () => {
    openDirtyDocument();
    renderTabs();

    await clickClose();
    await choose('Cancel');
    expectDocumentPreserved();

    await clickClose();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });
    expectDocumentPreserved();
  });

  it('uses the linked editable .slimg save path once before closing a dirty linked edit', async () => {
    const writeImageDocumentFile = vi.fn(async () => ({ ok: true }));
    window.signalLoomNative = { writeImageDocumentFile } as never;
    openDirtyDocument({ linkedEdit: { kind: 'slimg-node', filePath: '/tmp/flow-edit.slimg' } });
    renderTabs();

    await clickClose();
    await choose('Save');

    expect(writeImageDocumentFile).toHaveBeenCalledTimes(1);
    expect(writeImageDocumentFile).toHaveBeenCalledWith('/tmp/flow-edit.slimg', new Uint8Array([1, 2, 3]));
    expect(useImageEditorStore.getState().documents).toHaveLength(0);
  });

  it('keeps layered state dirty after a flattened Source Library export', async () => {
    openDirtyDocument();
    act(() => root.render(<ImageEditorAssetBar getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />));

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Export Visible'))
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useImageEditorStore.getState().documents[0]).toMatchObject({
      id: 'dirty-doc',
      dirty: true,
    });
  });

  it('blocks application unload while a dirty layered document is open', () => {
    openDirtyDocument();
    const dispose = installDirtyImageDocumentUnloadGuard(window);
    const event = new Event('beforeunload', { cancelable: true });

    const allowed = window.dispatchEvent(event);

    expect(allowed).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    dispose();
  });

  it('does not block application unload when every Image document is clean', () => {
    useImageEditorStore.getState().openDocument(createEmptyImageDocument({
      id: 'clean-doc',
      title: 'Saved artwork',
      width: 8,
      height: 8,
    }));
    const dispose = installDirtyImageDocumentUnloadGuard(window);
    const event = new Event('beforeunload', { cancelable: true });

    const allowed = window.dispatchEvent(event);

    expect(allowed).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    dispose();
  });
});
