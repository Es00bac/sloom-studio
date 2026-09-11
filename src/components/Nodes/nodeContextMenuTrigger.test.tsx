// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseNode } from './BaseNode';
import {
  detectCoarsePointer,
  dispatchNodeContextMenu,
  getNodeContextMenuAnchor,
} from './nodeContextMenuTrigger';

describe('dispatchNodeContextMenu', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('re-dispatches a bubbling contextmenu event an ancestor (React Flow) can catch', () => {
    const wrapper = document.createElement('div');
    const node = document.createElement('div');
    wrapper.appendChild(node);
    document.body.appendChild(wrapper);

    const received: MouseEvent[] = [];
    // Stand-in for React Flow's onNodeContextMenu listener on the .react-flow__node wrapper.
    wrapper.addEventListener('contextmenu', (event) => received.push(event as MouseEvent));

    const dispatched = dispatchNodeContextMenu(node, 128, 240);

    expect(dispatched).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('contextmenu');
    expect(received[0].clientX).toBe(128);
    expect(received[0].clientY).toBe(240);
    expect(received[0].bubbles).toBe(true);
  });

  it('is a no-op when the target element is missing', () => {
    expect(dispatchNodeContextMenu(null, 0, 0)).toBe(false);
  });
});

describe('getNodeContextMenuAnchor', () => {
  it('anchors under the bottom-left of the button', () => {
    expect(getNodeContextMenuAnchor({ left: 42, bottom: 90 })).toEqual({ clientX: 42, clientY: 90 });
  });
});

describe('detectCoarsePointer', () => {
  it('reports touch when maxTouchPoints is present', () => {
    const win = { navigator: { maxTouchPoints: 5 } } as unknown as Window;
    expect(detectCoarsePointer(win)).toBe(true);
  });

  it('falls back to a coarse-pointer media query', () => {
    const win = {
      navigator: { maxTouchPoints: 0 },
      matchMedia: vi.fn(() => ({ matches: true })),
    } as unknown as Window;
    expect(detectCoarsePointer(win)).toBe(true);
  });

  it('returns false for a fine-pointer desktop', () => {
    const win = {
      navigator: { maxTouchPoints: 0 },
      matchMedia: () => ({ matches: false }),
    } as unknown as Window;
    expect(detectCoarsePointer(win)).toBe(false);
  });
});

describe('BaseNode more-actions button', () => {
  it('renders a visible node-actions button when the node has an id', () => {
    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <BaseNode nodeId="node-1" nodeType="loopNode" icon={() => null} title="Simple Loop">
          <div>content</div>
        </BaseNode>
      </ReactFlowProvider>,
    );

    expect(html).toContain('aria-label="Node actions"');
  });

  it('exposes a named, keyboard-operable node landmark', () => {
    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <BaseNode nodeId="node-1" nodeType="loopNode" icon={() => null} title="Simple Loop">
          <div>content</div>
        </BaseNode>
      </ReactFlowProvider>,
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Simple Loop node"');
    expect(html).toContain('aria-keyshortcuts="Enter Space"');
    expect(html).toContain('tabindex="0"');
  });

  it('turns Enter on the node landmark into the bubbling selection click React Flow consumes', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <ReactFlowProvider>
          <BaseNode nodeId="node-1" nodeType="loopNode" icon={() => null} title="Simple Loop">
            <div>content</div>
          </BaseNode>
        </ReactFlowProvider>,
      );
    });

    const node = host.querySelector<HTMLElement>('[role="group"]');
    expect(node).not.toBeNull();
    const clicks: MouseEvent[] = [];
    node?.addEventListener('click', (event) => clicks.push(event));

    act(() => {
      node?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
    });

    expect(clicks).toHaveLength(1);
    act(() => root.unmount());
    host.remove();
  });

  it('turns Space on the node landmark into the same ordinary selection click', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <ReactFlowProvider>
          <BaseNode nodeId="node-1" nodeType="loopNode" icon={() => null} title="Simple Loop">
            <div>content</div>
          </BaseNode>
        </ReactFlowProvider>,
      );
    });

    const node = host.querySelector<HTMLElement>('[role="group"]');
    expect(node).not.toBeNull();
    const clicks: MouseEvent[] = [];
    node?.addEventListener('click', (event) => clicks.push(event));

    act(() => {
      node?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' }));
    });

    expect(clicks).toHaveLength(1);
    act(() => root.unmount());
    host.remove();
  });

  it('does not turn an action-button Space key into node selection', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <ReactFlowProvider>
          <BaseNode nodeId="node-1" nodeType="loopNode" icon={() => null} title="Simple Loop">
            <div>content</div>
          </BaseNode>
        </ReactFlowProvider>,
      );
    });

    const node = host.querySelector<HTMLElement>('[role="group"]');
    const actions = host.querySelector<HTMLElement>('button[aria-label="Node actions"]');
    expect(node).not.toBeNull();
    expect(actions).not.toBeNull();
    const clicks: MouseEvent[] = [];
    node?.addEventListener('click', (event) => clicks.push(event));

    act(() => {
      actions?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' }));
    });

    expect(clicks).toHaveLength(0);
    act(() => root.unmount());
    host.remove();
  });
});
