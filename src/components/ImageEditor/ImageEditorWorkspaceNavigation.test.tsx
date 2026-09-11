// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageLayer } from '../../types/imageEditor';
import { createMask, maskBoundingBox } from './SelectionMask';
import { ImageEditorWorkspace } from './ImageEditorWorkspace';
import { getSelection, setSelection } from './selectionRegistry';
import { onNativeRendererCommand, type NativeMenuCommand } from '../../lib/nativeApp';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import { panelKey } from '../../lib/dockablePanel';
import { IMAGE_DOCKABLE_WORKSPACE_ID } from './ImageDockablePanels';

vi.mock('./ImageEditorToolbar', () => ({ ImageEditorToolbar: () => null }));
vi.mock('./ImageEditorCanvas', () => ({ ImageEditorCanvas: () => null }));
vi.mock('./ImageEditorTabs', () => ({ ImageEditorTabs: () => null }));
vi.mock('./ImageEditorLayersPanel', () => ({ ImageEditorLayersPanel: () => null }));
vi.mock('./ImageEditorChannelsPanel', () => ({ ImageEditorChannelsPanel: () => null }));
vi.mock('./ImageEditorHistoryPanel', () => ({ ImageEditorHistoryPanel: () => null }));
vi.mock('./ImageEditorPathsPanel', () => ({ ImageEditorPathsPanel: () => null }));
vi.mock('./ImageEditorPropertiesPanel', () => ({ ImageEditorPropertiesPanel: () => null }));
vi.mock('./ImageEditorAssetBar', () => ({ ImageEditorAssetBar: () => null }));
vi.mock('./ImageEditorHelp', () => ({ ImageEditorHelp: () => null }));
vi.mock('./GenerativeFillBar', () => ({ GenerativeFillBar: () => null }));
vi.mock('./NewDocumentModal', () => ({ NewDocumentModal: () => null }));
vi.mock('./ImageEditorContextMenu', () => ({ ImageEditorContextMenu: () => null }));
vi.mock('../DockablePanel/DockablePanelHost', () => ({
  DockablePanelHost: ({ children, panels }: { children: ReactNode; panels?: Array<{ tabGroupId?: string }> }) => (
    <div data-tabbed-panel-count={panels?.filter((panel) => panel.tabGroupId).length ?? 0}>{children}</div>
  ),
}));
const nativeMenuMock = vi.hoisted(() => ({ handler: null as ((command: string) => void) | null }));
vi.mock('../../shared/native/useNativeMenuCommand', () => ({
  useNativeMenuCommand: (handler: (command: string) => void) => { nativeMenuMock.handler = handler; },
}));

describe('ImageEditorWorkspace navigation controls', () => {
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
    // The desktop workspace portals its controls into top-nav-bar slots; provide them so the
    // portaled zoom/nav controls render (they live in document.body, not the workspace container).
    for (const id of ['signal-loom-image-topbar-center-slot', 'signal-loom-image-topbar-right-slot']) {
      const slot = document.createElement('div');
      slot.id = id;
      document.body.append(slot);
    }
    root = createRoot(container);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      viewportContainerSize: { width: 800, height: 600 },
      undoStacks: {},
      redoStacks: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.getElementById('signal-loom-image-topbar-center-slot')?.remove();
    document.getElementById('signal-loom-image-topbar-right-slot')?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows explicit fit, actual-size, and zoom step controls for the active image document', () => {
    openNavigationDocument();

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    expect(document.querySelector('button[aria-label="Fit image to view"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Set image zoom to 100%"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Zoom image out"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Zoom image in"]')).not.toBeNull();
  });

  it('enables the default Layers/Channels/Paths tab group in the desktop Image workspace', () => {
    openNavigationDocument();

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    expect(container.querySelector('[data-tabbed-panel-count="3"]')).not.toBeNull();
  });

  it('applies navigation toolbar commands through the same viewport state as shortcuts', () => {
    openNavigationDocument();

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Fit image to view"]')?.click();
    });
    expect(activeViewport()).toEqual({ zoom: 2, panX: 0, panY: 100 });

    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Set image zoom to 100%"]')?.click();
    });
    expect(activeViewport().zoom).toBe(1);

    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Zoom image in"]')?.click();
    });
    expect(activeViewport().zoom).toBeCloseTo(1.5);

    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Zoom image out"]')?.click();
    });
    expect(activeViewport().zoom).toBe(1);
  });

  it('rotates the canvas view from toolbar buttons, keyboard shortcuts, and resets it', () => {
    openNavigationDocument();

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    expect(document.querySelector('button[aria-label="Rotate image view clockwise"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Rotate image view counterclockwise"]')).not.toBeNull();
    const badge = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Image view rotation is upright"]',
    );
    expect(badge?.disabled).toBe(true);

    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Rotate image view clockwise"]')?.click();
    });
    expect(activeViewport().rotationDeg).toBe(15);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, shiftKey: true, key: '.' }));
    });
    expect(activeViewport().rotationDeg).toBe(30);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, shiftKey: true, key: ',' }));
    });
    expect(activeViewport().rotationDeg).toBe(15);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, shiftKey: true, key: ',' }));
    });
    expect(activeViewport().rotationDeg).toBeUndefined();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, shiftKey: true, key: '.' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, shiftKey: true, key: '.' }));
    });
    expect(activeViewport().rotationDeg).toBe(30);

    const resetBadge = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset image view rotation"]',
    );
    expect(resetBadge?.textContent).toContain('30');
    act(() => {
      resetBadge?.click();
    });
    expect(activeViewport().rotationDeg).toBeUndefined();
    expect(activeViewport().zoom).toBe(1);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, shiftKey: true, key: '.' }));
    });
    expect(activeViewport().rotationDeg).toBe(15);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, shiftKey: true, key: '0' }));
    });
    expect(activeViewport().rotationDeg).toBeUndefined();
    expect(activeViewport().zoom).toBe(1);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: '0' }));
    });
    expect(activeViewport()).toEqual({ zoom: 2, panX: 0, panY: 100 });

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, shiftKey: true, key: '.' }));
    });
    expect(activeViewport().rotationDeg).toBeUndefined();
    input.remove();
  });

  it('supports Photoshop-style zoom and fit keyboard shortcuts without stealing input focus', () => {
    openNavigationDocument();

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: '=' }));
    });
    expect(activeViewport().zoom).toBeCloseTo(1.5);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: '-' }));
    });
    expect(activeViewport().zoom).toBe(1);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: '0' }));
    });
    expect(activeViewport()).toEqual({ zoom: 2, panX: 0, panY: 100 });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: '1' }));
    });
    expect(activeViewport().zoom).toBe(1);

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const before = activeViewport();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: '=' }));
    });
    expect(activeViewport()).toEqual(before);
    input.remove();
  });

  it('nudges the active committed selection with Arrow keys before moving the active layer', () => {
    openNavigationDocument();
    const docId = 'doc-navigation';
    const mask = createMask(400, 200);
    mask.data[2 * mask.width + 2] = 255;
    mask.data[2 * mask.width + 3] = 255;
    setSelection(docId, mask);
    useImageEditorStore.getState().setHasSelection(docId, true);
    const beforeLayer = useImageEditorStore.getState().getActiveDocument()?.layers[0];

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    });
    expect(maskBoundingBox(getSelection(docId)!)).toEqual({ x: 3, y: 2, width: 2, height: 1 });
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]).toMatchObject({
      x: beforeLayer?.x,
      y: beforeLayer?.y,
    });
    expect(useImageEditorStore.getState().undoStacks[docId]?.at(-1)?.kind).toBe('selection');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', shiftKey: true }));
    });
    expect(maskBoundingBox(getSelection(docId)!)).toEqual({ x: 3, y: 12, width: 2, height: 1 });
  });

  it('binds Ctrl+L / Ctrl+M / Ctrl+U to the Levels / Curves / Hue-Saturation adjustment commands', () => {
    openNavigationDocument();

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    const commands: NativeMenuCommand[] = [];
    const off = onNativeRendererCommand((command) => commands.push(command));

    try {
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'l' }));
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'm' }));
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'u' }));
      });
    } finally {
      off();
    }

    expect(commands).toEqual([
      'image:adjust-levels',
      'image:adjust-curves',
      'image:adjust-hue-saturation',
    ]);
  });

  it('does not fire adjustment commands for plain L / M / U (tool shortcuts) without Ctrl', () => {
    openNavigationDocument();

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    const commands: NativeMenuCommand[] = [];
    const off = onNativeRendererCommand((command) => commands.push(command));

    try {
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'l' }));
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'm' }));
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'u' }));
      });
    } finally {
      off();
    }

    expect(commands).toEqual([]);
  });

  it('toggles a dockable panel visibility from the Window > Panels menu command', () => {
    openNavigationDocument();

    act(() => {
      root.render(<ImageEditorWorkspace getNewFlowNodePosition={() => ({ x: 0, y: 0 })} />);
    });

    const key = panelKey(IMAGE_DOCKABLE_WORKSPACE_ID, 'channels');
    const modeOf = () => {
      const panels = useDockablePanelStore.getState();
      return panels.layouts[key]?.mode ?? panels.defaults[key]?.mode;
    };
    const startShown = modeOf() !== 'hidden';

    // First toggle hides a shown panel (or shows a hidden one).
    act(() => nativeMenuMock.handler?.('image:toggle-channels-panel'));
    expect(modeOf() === 'hidden').toBe(startShown);

    // Second toggle flips it back.
    act(() => nativeMenuMock.handler?.('image:toggle-channels-panel'));
    expect(modeOf() === 'hidden').toBe(!startShown);
  });
});

function openNavigationDocument() {
  const layer = imageLayer({ id: 'nav-layer', x: 20, y: 30 });
  const doc = {
    ...createEmptyImageDocument({
      id: 'doc-navigation',
      title: 'Navigation',
      width: 400,
      height: 200,
    }),
    layers: [layer],
    activeLayerId: layer.id,
    viewport: { zoom: 1, panX: 0, panY: 0 },
  };
  useImageEditorStore.getState().openDocument(doc);
}

function imageLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function activeViewport() {
  const doc = useImageEditorStore.getState().getActiveDocument();
  if (!doc) throw new Error('Expected active image document');
  return doc.viewport;
}
