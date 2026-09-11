// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import { DockablePanel } from './DockablePanel';
import { DockableDialog } from './DockableDialog';

/**
 * Minimized floating panels/dialogs ("collapsed" mode in a zone without a docked
 * edge strip) render as a slim draggable strip and expand back to 'floating'.
 */
describe('DockablePanel floating minimize', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useDockablePanelStore.setState({ defaults: {}, layouts: {} });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
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
  });

  it('minimizes a compact-floating overlay panel to the store collapsed mode', async () => {
    await act(async () => {
      root?.render(
        <DockablePanel
          chrome="compact-floating"
          fixedSize
          layout={{
            workspaceId: 'image',
            panelId: 'tiltmark-palette',
            mode: 'floating',
            dockZone: 'overlay',
            floatingRect: { x: 424, y: 112, width: 404, height: 590 },
            minSize: { width: 404, height: 590 },
            zOrder: 1,
          }}
          title="Color Studio"
        >
          <div>Studio</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    const minimize = document.querySelector('button[aria-label="Minimize Color Studio"]');
    expect(minimize).not.toBeNull();

    await act(async () => {
      minimize?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(useDockablePanelStore.getState().layouts['image/tiltmark-palette']?.mode).toBe('collapsed');
  });

  it('does not offer minimize for compact palettes in edge-strip zones', async () => {
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
            floatingRect: { x: 368, y: 112, width: 66, height: 393 },
            minSize: { width: 66, height: 393 },
            zOrder: 1,
          }}
          title="Tools"
        >
          <div>Palette</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    expect(document.querySelector('button[aria-label="Minimize Tools"]')).toBeNull();
  });

  it('offers minimize on standard-chrome floating overlay panels only', async () => {
    await act(async () => {
      root?.render(
        <DockablePanel
          layout={{
            workspaceId: 'image',
            panelId: 'adjustments',
            mode: 'floating',
            dockZone: 'overlay',
            floatingRect: { x: 160, y: 92, width: 520, height: 620 },
            minSize: { width: 320, height: 240 },
            zOrder: 1,
          }}
          title="Adjustments"
        >
          <div>Body</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });
    expect(document.querySelector('button[aria-label="Minimize Adjustments"]')).not.toBeNull();

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
            zOrder: 1,
          }}
          title="Layers"
        >
          <div>Layers</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });
    expect(document.querySelector('button[aria-label="Minimize Layers"]')).toBeNull();
  });

  it('renders a collapsed overlay panel as a strip without its body and expands back to floating', async () => {
    useDockablePanelStore.setState({
      defaults: {},
      layouts: {
        'image/tiltmark-palette': {
          workspaceId: 'image',
          panelId: 'tiltmark-palette',
          mode: 'collapsed',
          dockZone: 'overlay',
          floatingRect: { x: 424, y: 112, width: 404, height: 590 },
          minSize: { width: 404, height: 590 },
          zOrder: 1,
        },
      },
    });

    await act(async () => {
      root?.render(
        <DockablePanel
          chrome="compact-floating"
          fixedSize
          layout={useDockablePanelStore.getState().layouts['image/tiltmark-palette']}
          title="Color Studio"
        >
          <div>Studio body</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    const strip = document.querySelector('[aria-label="Color Studio minimized strip"]');
    expect(strip).not.toBeNull();
    expect(document.body.textContent).not.toContain('Studio body');
    expect(document.querySelector('[data-dockable-panel-mode="collapsed"]')).not.toBeNull();

    const expand = document.querySelector('button[aria-label="Expand Color Studio"]');
    expect(expand).not.toBeNull();
    await act(async () => {
      expand?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(useDockablePanelStore.getState().layouts['image/tiltmark-palette']?.mode).toBe('floating');
  });

  it('keeps a collapsed floating strip collapsed while it is dragged', async () => {
    useDockablePanelStore.setState({
      defaults: {},
      layouts: {
        'image/tiltmark-palette': {
          workspaceId: 'image',
          panelId: 'tiltmark-palette',
          mode: 'collapsed',
          dockZone: 'overlay',
          floatingRect: { x: 424, y: 112, width: 404, height: 590 },
          minSize: { width: 404, height: 590 },
          zOrder: 1,
        },
      },
    });

    act(() => {
      root?.render(
        <DockablePanel
          chrome="compact-floating"
          fixedSize
          layout={useDockablePanelStore.getState().layouts['image/tiltmark-palette']}
          title="Color Studio"
        >
          <div>Studio body</div>
        </DockablePanel>,
      );
    });

    const strip = document.querySelector('[aria-label="Color Studio minimized strip"]');
    expect(strip).not.toBeNull();

    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX: 440, clientY: 120 });
    Object.defineProperty(pointerDown, 'pointerId', { value: 21 });
    act(() => {
      strip?.dispatchEvent(pointerDown);
    });

    const pointerMove = new MouseEvent('pointermove', { bubbles: true, clientX: 500, clientY: 180 });
    Object.defineProperty(pointerMove, 'pointerId', { value: 21 });
    Object.defineProperty(pointerMove, 'preventDefault', { value: vi.fn() });
    Object.defineProperty(pointerMove, 'stopPropagation', { value: vi.fn() });
    act(() => {
      window.dispatchEvent(pointerMove);
    });

    const pointerUp = new MouseEvent('pointerup', { bubbles: true, clientX: 500, clientY: 180 });
    Object.defineProperty(pointerUp, 'pointerId', { value: 21 });
    Object.defineProperty(pointerUp, 'preventDefault', { value: vi.fn() });
    Object.defineProperty(pointerUp, 'stopPropagation', { value: vi.fn() });
    act(() => {
      window.dispatchEvent(pointerUp);
    });

    const layout = useDockablePanelStore.getState().layouts['image/tiltmark-palette'];
    expect(layout?.mode).toBe('collapsed');
    expect(layout?.floatingRect.x).not.toBe(424);
  });

  it('keeps the docked edge-strip collapse for side zones', async () => {
    await act(async () => {
      root?.render(
        <DockablePanel
          layout={{
            workspaceId: 'image',
            panelId: 'layers',
            mode: 'collapsed',
            dockZone: 'right',
            floatingRect: { x: 1120, y: 96, width: 300, height: 560 },
            minSize: { width: 224, height: 220 },
            zOrder: 1,
          }}
          title="Layers"
        >
          <div>Layers body</div>
        </DockablePanel>,
      );
      await Promise.resolve();
    });

    expect(document.querySelector('[aria-label="Layers minimized strip"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Expand Layers"]')).not.toBeNull();
  });
});

describe('DockableDialog minimize', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useDockablePanelStore.setState({ defaults: {}, layouts: {} });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
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
  });

  it('suppresses the modal backdrop and Escape-close while minimized', async () => {
    useDockablePanelStore.setState({
      defaults: {},
      layouts: {
        'image/adjustments': {
          workspaceId: 'image',
          panelId: 'adjustments',
          mode: 'collapsed',
          dockZone: 'overlay',
          floatingRect: { x: 160, y: 92, width: 520, height: 620 },
          minSize: { width: 320, height: 240 },
          zOrder: 1,
        },
      },
    });
    const onClose = vi.fn();

    await act(async () => {
      root?.render(
        <DockableDialog
          dialogId="adjustments"
          onClose={onClose}
          open
          title="Adjustments"
          workspaceId="image"
        >
          <div>Adjustments body</div>
        </DockableDialog>,
      );
      await Promise.resolve();
    });

    expect(document.querySelector('[aria-label="Adjustments minimized strip"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Close Adjustments"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Adjustments body');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await Promise.resolve();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape and shows the backdrop while expanded', async () => {
    const onClose = vi.fn();

    await act(async () => {
      root?.render(
        <DockableDialog
          defaultFloatingRect={{ x: 160, y: 92, width: 520, height: 620 }}
          dialogId="adjustments"
          onClose={onClose}
          open
          title="Adjustments"
          workspaceId="image"
        >
          <div>Adjustments body</div>
        </DockableDialog>,
      );
      await Promise.resolve();
    });

    expect(document.querySelector('button[aria-label="Close Adjustments"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
