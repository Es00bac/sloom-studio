// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageLayer, ImagePathVectorShape } from '../../types/imageEditor';
import { redo, undo } from './undoRedoApply';
import { normalizeImageTextStyle } from './ImageTextLayer';
import { ImageEditorWorkspace } from './ImageEditorWorkspace';
import { useDockablePanelStore } from '../../store/dockablePanelStore';

vi.mock('./ImageEditorToolbar', () => ({ ImageEditorToolbar: () => null }));
vi.mock('./ImageEditorCanvas', () => ({ ImageEditorCanvas: () => null }));
vi.mock('./ImageEditorTabs', () => ({ ImageEditorTabs: () => null }));
vi.mock('./ImageEditorChannelsPanel', () => ({ ImageEditorChannelsPanel: () => null }));
vi.mock('./ImageEditorHistoryPanel', () => ({ ImageEditorHistoryPanel: () => null }));
vi.mock('./ImageEditorPathsPanel', () => ({ ImageEditorPathsPanel: () => null }));
vi.mock('./ImageEditorPropertiesPanel', () => ({ ImageEditorPropertiesPanel: () => null }));
vi.mock('./ImageEditorAssetBar', () => ({ ImageEditorAssetBar: () => null }));
vi.mock('./ImageEditorHelp', () => ({ ImageEditorHelp: () => null }));
vi.mock('./GenerativeFillBar', () => ({ GenerativeFillBar: () => null }));
vi.mock('./NewDocumentModal', () => ({ NewDocumentModal: () => null }));
vi.mock('./ImageEditorContextMenu', () => ({ ImageEditorContextMenu: () => null }));
vi.mock('../Layout/FlowSourceBinSidebar', () => ({ FlowSourceBinSidebar: () => null }));
vi.mock('../DockablePanel/DockablePanelHost', () => ({
  DockablePanelHost: ({ children, panels }: { children: ReactNode; panels?: Array<{ panelId: string; content: ReactNode }> }) => (
    <div data-testid="workspace-dock-host">
      {children}
      {panels?.filter((panel) => panel.panelId === 'layers').map((panel) => (
        <section key={panel.panelId}>{panel.content}</section>
      ))}
    </div>
  ),
}));
vi.mock('../../shared/native/useNativeMenuCommand', () => ({
  useNativeMenuCommand: () => undefined,
}));

class FakeTextContext {
  font = '';
  fontKerning = '';
  fontVariantCaps = '';
  fillStyle = '';

  clearRect() {}
  drawImage() {}
  fillText() {}
  measureText(text: string) { return { width: text.length * 10 }; }
  restore() {}
  rotate() {}
  save() {}
  translate() {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  private readonly context = new FakeTextContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function textLayer(): ImageLayer {
  return {
    id: 'workspace-text',
    name: 'Workspace Text',
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 1,
    mask: null,
    text: normalizeImageTextStyle({ content: 'PATH', fontSize: 20, letterSpacing: 1 }),
    metadata: { editableText: true },
  };
}

function pathLayer(): ImageLayer {
  return {
    id: 'workspace-path',
    name: 'Workspace Bezier Path',
    type: 'vector',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 40,
    y: 50,
    bitmap: null,
    bitmapVersion: 3,
    mask: null,
    metadata: {
      vectorShape: {
        kind: 'path',
        width: 240,
        height: 120,
        points: [
          { x: 0, y: 72, outHandle: { x: 64, y: -12 } },
          { x: 240, y: 48, inHandle: { x: 176, y: 108 } },
        ],
        closed: false,
        fillColor: 'transparent',
        fillOpacity: 0,
        strokeColor: '#ffffff',
        strokeOpacity: 1,
        strokeWidth: 2,
      },
    },
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ImageEditorWorkspace retained text path editing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    container = document.createElement('div');
    document.body.append(container);
    for (const id of ['signal-loom-image-topbar-center-slot', 'signal-loom-image-topbar-right-slot']) {
      const slot = document.createElement('div');
      slot.id = id;
      document.body.append(slot);
    }
    root = createRoot(container);
    useDockablePanelStore.setState({
      defaults: {},
      layouts: {},
      collapsedDockColumns: {},
      savedLayouts: [],
    });
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.getElementById('signal-loom-image-topbar-center-slot')?.remove();
    document.getElementById('signal-loom-image-topbar-right-slot')?.remove();
    vi.unstubAllGlobals();
  });

  it('attaches through the real workspace panel, persists on snapshot reopen, and supports undo/redo', () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'workspace-path-doc', title: 'Path UI', width: 640, height: 400 }),
      layers: [pathLayer(), textLayer()],
      activeLayerId: 'workspace-text',
      selectedLayerIds: ['workspace-text'],
    };
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    const target = container.querySelector<HTMLSelectElement>('select[aria-label="Text path target"]');
    const offset = container.querySelector<HTMLInputElement>('input[aria-label="Text path start offset"]');
    const reverse = container.querySelector<HTMLInputElement>('input[aria-label="Reverse text path"]');
    const attach = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Attach');
    expect(target).not.toBeNull();
    expect(offset).not.toBeNull();
    expect(reverse).not.toBeNull();
    expect(attach).toBeDefined();
    expect(target?.options[0]?.textContent).toContain('Workspace Bezier Path');

    act(() => {
      setInputValue(offset!, '12');
      reverse!.click();
      attach?.click();
    });

    const attached = useImageEditorStore.getState().getActiveDocument()?.layers.find((layer) => layer.id === 'workspace-text');
    expect(attached?.text?.pathReference).toMatchObject({
      kind: 'vector-layer',
      layerId: 'workspace-path',
      revision: 3,
    });
    expect(attached?.text?.pathLayout).toMatchObject({
      geometry: 'bezier-sampled-path',
      startOffset: 12,
      reverse: true,
    });
    expect(attached?.bitmap).not.toBeNull();
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)?.kind).toBe('layerOp');

    expect(undo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers.find((layer) => layer.id === 'workspace-text')?.text?.pathLayout).toBeUndefined();
    expect(redo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers.find((layer) => layer.id === 'workspace-text')?.text?.pathLayout?.geometry).toBe('bezier-sampled-path');

    const beforeHandleEdit = useImageEditorStore.getState().getActiveDocument()!.layers;
    const currentPath = beforeHandleEdit.find((layer) => layer.id === 'workspace-path')!;
    const currentPathShape = currentPath.metadata?.vectorShape;
    if (!currentPathShape || currentPathShape.kind !== 'path') throw new Error('Expected retained path geometry.');
    const editedPathShape = {
      ...currentPathShape,
      points: [
        { x: 0, y: 72, outHandle: { x: 64, y: 120 } },
        { x: 240, y: 48, inHandle: { x: 176, y: 0 } },
      ],
    } satisfies ImagePathVectorShape;
    const editedPath = {
      ...currentPath,
      bitmapVersion: currentPath.bitmapVersion + 1,
      metadata: {
        ...currentPath.metadata,
        vectorShape: editedPathShape,
      },
    } satisfies ImageLayer;
    const afterHandleEdit = beforeHandleEdit.map((layer) => (
      layer.id === editedPath.id ? editedPath : layer
    ));
    useImageEditorStore.getState().pushOperation({
      kind: 'layerOp',
      docId: doc.id,
      before: beforeHandleEdit,
      after: afterHandleEdit,
    });
    useImageEditorStore.getState().setLayers(doc.id, afterHandleEdit, editedPath.id);

    const editedText = useImageEditorStore.getState().getActiveDocument()!.layers.find((layer) => layer.id === 'workspace-text')!;
    expect(editedText.text?.pathReference?.revision).toBe(4);
    expect(editedText.text?.pathLayout?.previewSignature).not.toBe(attached?.text?.pathLayout?.previewSignature);
    expect(editedText.text?.pathLayout).toMatchObject({ startOffset: 12, reverse: true });
    expect(editedText.bitmapVersion).toBeGreaterThan(attached?.bitmapVersion ?? 0);

    expect(undo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers.find((layer) => layer.id === 'workspace-text')?.text?.pathLayout?.previewSignature)
      .toBe(attached?.text?.pathLayout?.previewSignature);
    expect(redo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers.find((layer) => layer.id === 'workspace-text')?.text?.pathLayout?.previewSignature)
      .toBe(editedText.text?.pathLayout?.previewSignature);

    const saved = useImageEditorStore.getState().exportProjectSnapshot();
    useImageEditorStore.getState().restoreProjectSnapshot(saved);
    const reopened = useImageEditorStore.getState().getActiveDocument()?.layers.find((layer) => layer.id === 'workspace-text');
    expect(reopened?.text?.pathReference?.layerId).toBe('workspace-path');
    expect(reopened?.text?.pathLayout?.geometry).toBe('bezier-sampled-path');
    expect(reopened?.text?.pathLayout?.startOffset).toBe(12);
    expect(reopened?.text?.pathLayout?.reverse).toBe(true);
    expect(reopened?.text?.pathReference?.revision).toBe(4);
    expect(reopened?.text?.pathLayout?.previewSignature).toBe(editedText.text?.pathLayout?.previewSignature);
  });
});
