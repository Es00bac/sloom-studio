// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DockablePanelLayout, panelKey } from '../../lib/dockablePanel';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import { DockablePanel } from './DockablePanel';

const WORKSPACE_ID = 'image';
const PANEL_ID = 'layers';
const KEY = panelKey(WORKSPACE_ID, PANEL_ID);

function createFloatingLayout(
  floatingRect: DockablePanelLayout['floatingRect'],
): DockablePanelLayout {
  return {
    workspaceId: WORKSPACE_ID,
    panelId: PANEL_ID,
    mode: 'floating',
    dockZone: 'right',
    floatingRect,
    minSize: { width: 224, height: 160 },
    zOrder: 10,
  };
}

function StoreBackedPanel() {
  const layout = useDockablePanelStore((state) => state.layouts[KEY]);
  return layout ? (
    <DockablePanel layout={layout} title="Layers" viewport={{ width: 1280, height: 900 }}>
      <div>Layers</div>
    </DockablePanel>
  ) : null;
}

describe('DockablePanel floating geometry reliability', () => {
  let host: HTMLDivElement;
  let root: Root;
  let originalSetPointerCapture: typeof HTMLElement.prototype.setPointerCapture | undefined;
  let originalReleasePointerCapture: typeof HTMLElement.prototype.releasePointerCapture | undefined;
  let originalScreenX: PropertyDescriptor | undefined;
  let originalScreenY: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useDockablePanelStore.setState({ defaults: {}, layouts: {} });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
    originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;
    originalScreenX = Object.getOwnPropertyDescriptor(window, 'screenX');
    originalScreenY = Object.getOwnPropertyDescriptor(window, 'screenY');
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.signalLoomNative;
    restoreProperty(window, 'screenX', originalScreenX);
    restoreProperty(window, 'screenY', originalScreenY);
    restoreProperty(HTMLElement.prototype, 'setPointerCapture', originalSetPointerCapture
      ? { configurable: true, value: originalSetPointerCapture, writable: true }
      : undefined);
    restoreProperty(HTMLElement.prototype, 'releasePointerCapture', originalReleasePointerCapture
      ? { configurable: true, value: originalReleasePointerCapture, writable: true }
      : undefined);
  });

  it('continues the first drag from an offscreen owner rect at its clamped rendered position', () => {
    const layout = createFloatingLayout({ x: 1600, y: -200, width: 400, height: 300 });
    useDockablePanelStore.setState({ defaults: { [KEY]: layout }, layouts: { [KEY]: layout } });

    act(() => {
      root.render(
        <DockablePanel layout={layout} title="Layers" viewport={{ width: 1000, height: 700 }}>
          <div>Layers</div>
        </DockablePanel>,
      );
    });

    const panel = host.querySelector<HTMLElement>('[data-dockable-panel-id="layers"]');
    const handle = host.querySelector<HTMLElement>('[aria-label="Layers drag handle"]');
    expect(panel?.style.left).toBe('592px');
    expect(panel?.style.top).toBe('8px');

    const pointerDown = pointerEvent('pointerdown', 31, 610, 36);
    act(() => {
      handle?.dispatchEvent(pointerDown);
    });
    expect(useDockablePanelStore.getState().layouts[KEY].floatingRect).toEqual({
      x: 592,
      y: 8,
      width: 400,
      height: 300,
    });

    const pointerMove = pointerEvent('pointermove', 31, 590, 48, { ctrlKey: true });
    act(() => {
      window.dispatchEvent(pointerMove);
    });
    expect(useDockablePanelStore.getState().layouts[KEY].floatingRect).toEqual({
      x: 572,
      y: 20,
      width: 400,
      height: 300,
    });

    act(() => {
      window.dispatchEvent(pointerEvent('pointerup', 31, 590, 48, { ctrlKey: true }));
    });
  });

  it('does not accumulate hidden overshoot when an owner-window panel reaches the viewport edge', () => {
    const layout = createFloatingLayout({ x: 592, y: 392, width: 400, height: 300 });
    useDockablePanelStore.setState({ defaults: { [KEY]: layout }, layouts: { [KEY]: layout } });

    act(() => {
      root.render(<StoreBackedPanel />);
    });

    const handle = host.querySelector<HTMLElement>('[aria-label="Layers drag handle"]');
    act(() => {
      handle?.dispatchEvent(pointerEvent('pointerdown', 32, 610, 410));
      window.dispatchEvent(pointerEvent('pointermove', 32, 900, 650));
    });
    expect(useDockablePanelStore.getState().layouts[KEY].floatingRect).toMatchObject({
      x: 872,
      y: 592,
    });

    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', 32, 880, 630));
    });
    expect(useDockablePanelStore.getState().layouts[KEY].floatingRect).toMatchObject({
      x: 852,
      y: 572,
    });

    act(() => {
      window.dispatchEvent(pointerEvent('pointerup', 32, 880, 630, { ctrlKey: true }));
    });
  });

  it('keeps a reposition gesture floating when the panel started floating', () => {
    const layout = createFloatingLayout({ x: 200, y: 200, width: 400, height: 300 });
    useDockablePanelStore.setState({ defaults: { [KEY]: layout }, layouts: { [KEY]: layout } });

    act(() => {
      root.render(<StoreBackedPanel />);
    });

    const handle = host.querySelector<HTMLElement>('[aria-label="Layers drag handle"]');
    act(() => {
      handle?.dispatchEvent(pointerEvent('pointerdown', 33, 220, 218));
      window.dispatchEvent(pointerEvent('pointermove', 33, 4, 260));
      window.dispatchEvent(pointerEvent('pointerup', 33, 4, 260));
    });

    expect(useDockablePanelStore.getState().layouts[KEY]).toMatchObject({
      mode: 'floating',
      floatingRect: { x: 8, y: 242, width: 400, height: 300 },
    });

    const dockButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Dock');
    act(() => {
      dockButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useDockablePanelStore.getState().layouts[KEY]).toMatchObject({
      mode: 'docked',
      dockZone: 'right',
      floatingRectSpace: undefined,
    });
  });

  it('keeps native Wayland floating panels in the owner window instead of opening an unmovable popup', async () => {
    window.signalLoomNative = { supportsExternalFloatingPanelWindows: false } as never;
    const open = vi.spyOn(window, 'open');
    const layout = createFloatingLayout({ x: 240, y: 160, width: 400, height: 300 });
    useDockablePanelStore.setState({ defaults: { [KEY]: layout }, layouts: { [KEY]: layout } });

    await act(async () => {
      root.render(<StoreBackedPanel />);
      await Promise.resolve();
    });

    expect(open).not.toHaveBeenCalled();
    expect(host.querySelector('[data-dockable-panel-id="layers"]')).not.toBeNull();
  });

  it('persists a manual native resize instead of restoring the previous popup size', async () => {
    window.signalLoomNative = {} as never;
    Object.defineProperty(window, 'screenX', { configurable: true, value: 2000 });
    Object.defineProperty(window, 'screenY', { configurable: true, value: 80 });
    const layout = createFloatingLayout({ x: 1120, y: 96, width: 300, height: 560 });
    useDockablePanelStore.setState({ defaults: { [KEY]: layout }, layouts: { [KEY]: layout } });

    const popupDocument = document.implementation.createHTMLDocument('Layers');
    const listeners = new Map<string, Set<EventListener>>();
    const popup = {
      closed: false,
      document: popupDocument,
      screenX: 3120,
      screenY: 176,
      innerWidth: 300,
      innerHeight: 560,
      outerWidth: 316,
      outerHeight: 596,
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        const registered = listeners.get(type) ?? new Set<EventListener>();
        registered.add(listener);
        listeners.set(type, registered);
      }),
      close: vi.fn(),
      moveTo: vi.fn(),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.get(type)?.delete(listener);
      }),
      resizeTo: vi.fn(),
    };
    Object.defineProperty(popupDocument, 'defaultView', { configurable: true, value: popup });
    const open = vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);

    await act(async () => {
      root.render(<StoreBackedPanel />);
      await Promise.resolve();
    });

    expect(open).toHaveBeenCalledTimes(1);
    popup.resizeTo.mockClear();
    popup.innerWidth = 480;
    popup.innerHeight = 620;
    popup.outerWidth = 496;
    popup.outerHeight = 656;

    await act(async () => {
      listeners.get('resize')?.forEach((listener) => listener(new Event('resize')));
      await Promise.resolve();
    });

    expect(useDockablePanelStore.getState().layouts[KEY]).toMatchObject({
      floatingRect: { x: 1120, y: 96, width: 480, height: 620 },
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(popup.resizeTo).not.toHaveBeenCalled();
  });
});

function pointerEvent(
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
  options: MouseEventInit = {},
): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY, ...options });
  Object.defineProperty(event, 'pointerId', { configurable: true, value: pointerId });
  return event;
}

function restoreProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
}
