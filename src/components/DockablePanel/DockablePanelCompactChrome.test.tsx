// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import { DockablePanel } from './DockablePanel';

describe('DockablePanel compact floating chrome', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  let originalSetPointerCapture: typeof HTMLElement.prototype.setPointerCapture | undefined;
  let originalReleasePointerCapture: typeof HTMLElement.prototype.releasePointerCapture | undefined;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useDockablePanelStore.setState({ defaults: {}, layouts: {} });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
    originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.signalLoomNative;
    if (originalSetPointerCapture) {
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
    } else {
      delete (HTMLElement.prototype as Partial<typeof HTMLElement.prototype>).setPointerCapture;
    }
    if (originalReleasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
    } else {
      delete (HTMLElement.prototype as Partial<typeof HTMLElement.prototype>).releasePointerCapture;
    }
  });

  it('renders a movable fixed palette without dock buttons or resize handles', async () => {
    // Compact palettes portal to <body> (so they stack above everything), so render client-side and
    // inspect the portaled panel rather than a server-rendered string (portals are skipped in SSR).
    await act(async () => {
      root?.render(
        <DockablePanel
          chrome="compact-floating"
          fixedSize
          layout={{
            workspaceId: 'image',
            panelId: 'tools',
            mode: 'floating',
            dockZone: 'left',
            floatingRect: { x: 20, y: 30, width: 66, height: 120 },
            minSize: { width: 66, height: 120 },
            zOrder: 10,
          }}
          title="Tools"
        >
          <div>Palette</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    const panel = document.querySelector('[data-dockable-panel-chrome="compact-floating"]');
    expect(panel).not.toBeNull();
    const html = panel?.outerHTML ?? '';
    expect(html).toContain('aria-label="Tools drag handle"');
    expect(html).not.toContain('data-dockable-tab-target="true"');
    expect(html).not.toContain('Dock</button>');
    expect(html).not.toContain('Resize bottom');
    expect(html).not.toContain('Resize right');
  });

  it('renders compact palette chrome without resizable flex-fill body behavior', async () => {
    await act(async () => {
      root?.render(
        <DockablePanel
          chrome="compact-floating"
          fixedSize
          layout={{
            workspaceId: 'image',
            panelId: 'tools',
            mode: 'floating',
            dockZone: 'left',
            floatingRect: { x: 20, y: 30, width: 66, height: 456 },
            minSize: { width: 66, height: 456 },
            zOrder: 10,
          }}
          title="Tools"
        >
          <div>Palette</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    const panel = document.querySelector('[data-dockable-panel-chrome="compact-floating"]');
    expect(panel).not.toBeNull();
    const html = panel?.outerHTML ?? '';
    expect(html).not.toContain('role="separator"');
    expect(html).not.toContain('flex-1');
    expect(html).toContain('flex-none');
  });

  it('does not render a dock button for fixed native Photoshop-style palettes', async () => {
    window.signalLoomNative = {} as never;
    const popupDocument = document.implementation.createHTMLDocument('Color');
    const popup = {
      closed: false,
      document: popupDocument,
      screenX: 220,
      screenY: 120,
      innerWidth: 180,
      innerHeight: 260,
      outerWidth: 180,
      outerHeight: 260,
      addEventListener: vi.fn(),
      close: vi.fn(),
      moveTo: vi.fn(),
      removeEventListener: vi.fn(),
      resizeTo: vi.fn(),
    };
    vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);

    await act(async () => {
      root?.render(
        <DockablePanel
          fixedSize
          layout={{
            workspaceId: 'image',
            panelId: 'color',
            mode: 'floating',
            dockZone: 'right',
            floatingRect: { x: 220, y: 120, width: 180, height: 260 },
            minSize: { width: 180, height: 260 },
            zOrder: 10,
          }}
          title="Color"
        >
          <div>Color</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    expect(popupDocument.querySelector('[data-dockable-workspace-id="image"]')?.textContent).not.toContain('Dock');
  });

  it('renders the compact tools palette in the owner window instead of a native popup', async () => {
    // A ~66px palette cannot be its own native OS window (the window manager enforces a minimum width
    // of ~100px, leaving an empty strip beside the content), so compact chrome renders in-window.
    window.signalLoomNative = {} as never;
    const open = vi.spyOn(window, 'open');

    await act(async () => {
      root?.render(
        <DockablePanel
          chrome="compact-floating"
          fixedSize
          layout={{
            workspaceId: 'image',
            panelId: 'tools',
            mode: 'floating',
            dockZone: 'left',
            floatingRect: { x: 368, y: 112, width: 66, height: 456 },
            minSize: { width: 66, height: 456 },
            zOrder: 10,
          }}
          title="Tools"
        >
          <div>Palette</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    expect(open).not.toHaveBeenCalled();
    const panel = document.querySelector('[data-dockable-workspace-id="image"][data-dockable-panel-id="tools"]');
    expect(panel).not.toBeNull();
    expect(document.body.textContent).toContain('Palette');
    expect(document.querySelector('[aria-label="Tools drag handle"]')).not.toBeNull();
  });

  it('renders compact native chrome in-window even when fixedSize is omitted', async () => {
    window.signalLoomNative = {} as never;
    const open = vi.spyOn(window, 'open');

    await act(async () => {
      root?.render(
        <DockablePanel
          chrome="compact-floating"
          layout={{
            workspaceId: 'image',
            panelId: 'tools',
            mode: 'floating',
            dockZone: 'left',
            floatingRect: { x: 368, y: 112, width: 66, height: 456 },
            minSize: { width: 66, height: 456 },
            zOrder: 10,
          }}
          title="Tools"
        >
          <div>Palette</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    expect(open).not.toHaveBeenCalled();
    const panel = document.querySelector('[data-dockable-panel-chrome="compact-floating"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).not.toContain('Dock');
    expect(document.body.textContent).toContain('Palette');
  });

  it('opens native floating dialogs at explicit desktop-screen coordinates without owner offset drift', async () => {
    window.signalLoomNative = {} as never;
    Object.defineProperty(window, 'screenX', { configurable: true, value: 2000 });
    Object.defineProperty(window, 'screenY', { configurable: true, value: 80 });
    const popupDocument = document.implementation.createHTMLDocument('Layers');
    const popup = {
      closed: false,
      document: popupDocument,
      screenX: -1720,
      screenY: 140,
      innerWidth: 640,
      innerHeight: 420,
      outerWidth: 640,
      outerHeight: 420,
      addEventListener: vi.fn(),
      close: vi.fn(),
      moveTo: vi.fn(),
      removeEventListener: vi.fn(),
      resizeTo: vi.fn(),
    };
    const open = vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);

    await act(async () => {
      root?.render(
        <DockablePanel
          layout={{
            workspaceId: 'image',
            panelId: 'layers',
            mode: 'floating',
            dockZone: 'right',
            floatingRect: { x: -1720, y: 140, width: 640, height: 420 },
            floatingRectSpace: 'screen',
            minSize: { width: 240, height: 180 },
            zOrder: 10,
          }}
          title="Layers"
        >
          <div>Layers</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    expect(open).toHaveBeenCalledWith(
      '',
      'signal-loom-image-layers',
      'popup=yes,frame=false,width=640,height=420,left=-1720,top=140',
    );
  });

  it('does not mutate fixed palette geometry while dragging compact chrome panels in owner-window mode', () => {
    useDockablePanelStore.setState({
      defaults: {},
      layouts: {
        'image/tools': {
          workspaceId: 'image',
          panelId: 'tools',
          mode: 'floating',
          dockZone: 'left',
          floatingRect: { x: 20, y: 30, width: 66, height: 456 },
          minSize: { width: 66, height: 456 },
          zOrder: 10,
        },
      },
    });

    const resizeFloatingPanelSpy = vi.spyOn(useDockablePanelStore.getState(), 'resizeFloatingPanel');

    act(() => {
      root?.render(
        <DockablePanel
          chrome="compact-floating"
          fixedSize
          layout={{
            workspaceId: 'image',
            panelId: 'tools',
            mode: 'floating',
            dockZone: 'left',
            floatingRect: { x: 20, y: 30, width: 66, height: 456 },
            minSize: { width: 66, height: 456 },
            zOrder: 10,
          }}
          title="Tools"
        >
          <div>Palette</div>
        </DockablePanel>,
      );
    });

    const handle = document.querySelector('[aria-label="Tools drag handle"]');
    expect(handle).not.toBeNull();
    const before = useDockablePanelStore.getState().layouts['image/tools'];

    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 25,
      clientY: 34,
      screenX: 50,
      screenY: 80,
    });
    Object.defineProperty(pointerDown, 'pointerId', { value: 17 });

    act(() => {
      handle?.dispatchEvent(pointerDown);
    });

    const pointerMove = new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 49,
      clientY: 58,
      screenX: 74,
      screenY: 104,
    });
    Object.defineProperty(pointerMove, 'pointerId', { value: 17 });
    Object.defineProperty(pointerMove, 'preventDefault', { value: vi.fn() });
    Object.defineProperty(pointerMove, 'stopPropagation', { value: vi.fn() });

    act(() => {
      window.dispatchEvent(pointerMove);
    });

    const pointerUp = new MouseEvent('pointerup', {
      bubbles: true,
      clientX: 49,
      clientY: 58,
      screenX: 74,
      screenY: 104,
    });
    Object.defineProperty(pointerUp, 'pointerId', { value: 17 });
    Object.defineProperty(pointerUp, 'preventDefault', { value: vi.fn() });
    Object.defineProperty(pointerUp, 'stopPropagation', { value: vi.fn() });

    act(() => {
      window.dispatchEvent(pointerUp);
    });

    const after = useDockablePanelStore.getState().layouts['image/tools'];
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(after?.floatingRect.width).toBe(before?.floatingRect.width);
    expect(after?.floatingRect.height).toBe(before?.floatingRect.height);
    expect(resizeFloatingPanelSpy).not.toHaveBeenCalled();
  });

  it('renders the compact palette in-window at its content size (no oversized native popup, no empty strip)', async () => {
    window.signalLoomNative = {} as never;
    const open = vi.spyOn(window, 'open');

    await act(async () => {
      root?.render(
        <DockablePanel
          chrome="compact-floating"
          fixedSize
          layout={{
            workspaceId: 'image',
            panelId: 'tools',
            mode: 'floating',
            dockZone: 'left',
            floatingRect: { x: 368, y: 112, width: 66, height: 456 },
            minSize: { width: 66, height: 456 },
            zOrder: 10,
          }}
          title="Tools"
        >
          <div>Palette</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    // No native popup is opened, so there is no OS-minimum-width surface and no empty strip: the
    // in-window panel is sized exactly to its content.
    expect(open).not.toHaveBeenCalled();
    const panel = document.querySelector('[data-dockable-workspace-id="image"][data-dockable-panel-id="tools"]') as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('style')).toContain('width: 66px');
    expect(panel?.getAttribute('style')).toContain('height: 456px');
  });

  it('keeps the compact palette draggable in-window without opening a native popup', async () => {
    window.signalLoomNative = {} as never;
    const open = vi.spyOn(window, 'open');

    await act(async () => {
      root?.render(
        <DockablePanel
          chrome="compact-floating"
          fixedSize
          layout={{
            workspaceId: 'image',
            panelId: 'tools',
            mode: 'floating',
            dockZone: 'left',
            floatingRect: { x: 368, y: 112, width: 66, height: 456 },
            minSize: { width: 66, height: 456 },
            zOrder: 10,
          }}
          title="Tools"
        >
          <div>Palette</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    // The palette is moved by dragging its handle within the owner window; no native popup is created.
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Tools drag handle"]')).not.toBeNull();
  });

  it('reasserts standard native floating dialog size while dragging if the popup surface drifts larger', async () => {
    window.signalLoomNative = {} as never;
    Object.defineProperty(window, 'screenX', { configurable: true, value: 2000 });
    Object.defineProperty(window, 'screenY', { configurable: true, value: 80 });
    const popupDocument = document.implementation.createHTMLDocument('Layers');
    const listeners = new Map<string, Set<(event: Record<string, unknown>) => void>>();
    const popup = {
      closed: false,
      document: popupDocument,
      screenX: 2368,
      screenY: 192,
      innerWidth: 300,
      innerHeight: 560,
      outerWidth: 300,
      outerHeight: 560,
      addEventListener: vi.fn((type: string, listener: (event: Record<string, unknown>) => void) => {
        const set = listeners.get(type) ?? new Set<(event: Record<string, unknown>) => void>();
        set.add(listener);
        listeners.set(type, set);
      }),
      close: vi.fn(),
      moveTo: vi.fn(),
      removeEventListener: vi.fn((type: string, listener: (event: Record<string, unknown>) => void) => {
        listeners.get(type)?.delete(listener);
      }),
      resizeTo: vi.fn(),
    };
    Object.defineProperty(popupDocument, 'defaultView', { configurable: true, value: popup });
    vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);

    await act(async () => {
      root?.render(
        <DockablePanel
          layout={{
            workspaceId: 'image',
            panelId: 'layers',
            mode: 'floating',
            dockZone: 'right',
            floatingRect: { x: 1120, y: 96, width: 300, height: 560 },
            minSize: { width: 224, height: 220 },
            zOrder: 10,
          }}
          title="Layers"
        >
          <div>Layers</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    const handle = popupDocument.querySelector('[aria-label="Layers drag handle"]') as HTMLElement | null;
    expect(handle).not.toBeNull();

    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 1180,
      clientY: 120,
      screenX: 3180,
      screenY: 200,
    });
    Object.defineProperty(pointerDown, 'pointerId', { configurable: true, value: 9 });

    act(() => {
      handle?.dispatchEvent(pointerDown);
    });

    popup.innerWidth = 388;
    popup.innerHeight = 684;
    popup.outerWidth = 388;
    popup.outerHeight = 684;

    const pointerMove = {
      pointerId: 9,
      clientX: 1210,
      clientY: 156,
      screenX: 3210,
      screenY: 236,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => {
      listeners.get('pointermove')?.forEach((listener) => listener(pointerMove));
    });

    expect(popup.moveTo).toHaveBeenCalled();
    expect(popup.resizeTo).toHaveBeenCalledWith(300, 560);
  });
});
