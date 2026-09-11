// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { ImageEditorWorkspace } from './ImageEditorWorkspace';

vi.mock('./ImageEditorToolbar', () => ({ ImageEditorToolbar: () => null }));
vi.mock('./ImageEditorCanvas', () => ({ ImageEditorCanvas: () => null }));
vi.mock('./ImageEditorTabs', () => ({ ImageEditorTabs: () => null }));
vi.mock('./ImageEditorLayersPanel', () => ({ ImageEditorLayersPanel: () => null }));
vi.mock('./ImageEditorChannelsPanel', () => ({ ImageEditorChannelsPanel: () => null }));
vi.mock('./ImageEditorHistoryPanel', () => ({ ImageEditorHistoryPanel: () => null }));
vi.mock('./ImageEditorPropertiesPanel', () => ({ ImageEditorPropertiesPanel: () => null }));
vi.mock('./ImageEditorAssetBar', () => ({ ImageEditorAssetBar: () => null }));
vi.mock('./ImageEditorHelp', () => ({ ImageEditorHelp: () => null }));
vi.mock('./GenerativeFillBar', () => ({ GenerativeFillBar: () => null }));
vi.mock('./NewDocumentModal', () => ({ NewDocumentModal: () => null }));
vi.mock('./ImageEditorContextMenu', () => ({ ImageEditorContextMenu: () => null }));
vi.mock('../DockablePanel/DockablePanelHost', () => ({
  DockablePanelHost: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../shared/native/useNativeMenuCommand', () => ({
  useNativeMenuCommand: () => undefined,
}));

describe('ImageEditorWorkspace QuickMask shortcut', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      quickMaskSettings: {
        enabled: false,
        viewMode: 'maskedAreas',
        overlayOpacity: 0.5,
      },
      undoStacks: {},
      redoStacks: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('toggles QuickMask mode when Q is pressed in the Image workspace', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-1',
      title: 'Quick Mask',
      width: 128,
      height: 96,
    });
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'q' }));
    });
    expect(useImageEditorStore.getState().quickMaskSettings.enabled).toBe(true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'q' }));
    });
    expect(useImageEditorStore.getState().quickMaskSettings.enabled).toBe(false);
  });
});
