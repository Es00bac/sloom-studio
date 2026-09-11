// @vitest-environment jsdom
import type { ComponentType } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../../../types/flow';

const setViewport = vi.fn();
const getViewport = vi.fn(() => ({ x: 0, y: 0, zoom: 1 }));

vi.mock('@xyflow/react', async () => ({
  Background: () => <div data-testid="flow-background" />,
  Controls: () => <div data-testid="flow-controls" />,
  // Render a realistic-enough canvas: a `.react-flow` container with a node inside it,
  // so the shell's "started inside canvas" guard and over-a-node case are exercised.
  ReactFlow: ({ children }: { children?: any }) => (
    <div className="react-flow" data-testid="react-flow-shell">
      <div className="react-flow__node" data-testid="fake-node">
        node
      </div>
      {children}
    </div>
  ),
  useReactFlow: () => ({ getViewport, setViewport }),
  useStoreApi: () => ({ getState: () => ({ minZoom: 0.25, maxZoom: 4 }) }),
  useStore: (selector: (state: unknown) => unknown) => selector({ nodeLookup: new Map() }),
}));

import { FlowWorkspaceShell } from './FlowWorkspaceShell';

const baseProps = {
  blockingFlowDiagnosticCount: 0,
  diagnosticsOpen: false,
  flowDiagnostics: [],
  flowOrganizeJob: null,
  flowRecoveryKey: 'flow::recovery',
  librarySearchMenu: null,
  nodeTypes: {} as Record<string, ComponentType<any>>,
  nodes: [] as AppNode[],
  edges: [] as Edge[],
  onCloseDiagnostics: () => {},
  onCloseLibrarySearch: () => {},
  onCollapseSelection: () => {},
  onConnect: () => {},
  onConnectEnd: () => {},
  onConnectStart: () => {},
  onCreateGroupFromSelection: () => {},
  onDragOver: () => {},
  onDrop: () => {},
  onEdgesChange: () => {},
  onNodeContextMenu: () => {},
  onNodesChange: () => {},
  onPaneClick: () => {},
  onPaneContextMenu: () => {},
  onSelectLibrarySearchTemplate: () => {},
  onStartFlowAutoOrganize: () => {},
  onToggleDiagnostics: () => {},
  onCancelFlowAutoOrganize: () => {},
  selectedFlowNodeCount: 0,
};

function touchEvent(type: string, points: Array<{ clientX: number; clientY: number }>) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: points, configurable: true });
  return event;
}

describe('FlowWorkspaceShell pinch-zoom over nodes', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    setViewport.mockClear();
    getViewport.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root!.render(<FlowWorkspaceShell {...baseProps} />);
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  it('drives setViewport when a two-finger pinch starts on a node', () => {
    const node = document.querySelector('[data-testid="fake-node"]') as HTMLElement;
    expect(node).not.toBeNull();

    // Two fingers land on the node (this used to drag the node instead of zooming).
    const start = touchEvent('touchstart', [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]); // distance 100
    act(() => {
      node.dispatchEvent(start);
    });
    // The gesture is claimed (so node drag / page zoom can't act on it).
    expect(start.defaultPrevented).toBe(true);

    // Spread the fingers apart -> zoom in.
    act(() => {
      node.dispatchEvent(
        touchEvent('touchmove', [
          { clientX: 50, clientY: 100 },
          { clientX: 250, clientY: 100 },
        ]), // distance 200 -> 2x
      );
    });

    expect(setViewport).toHaveBeenCalled();
    const lastViewport = setViewport.mock.calls.at(-1)?.[0];
    expect(lastViewport.zoom).toBeCloseTo(2, 5);
  });

  it('ignores single-finger touches (leaves pan/drag to React Flow)', () => {
    const node = document.querySelector('[data-testid="fake-node"]') as HTMLElement;
    const oneFinger = touchEvent('touchstart', [{ clientX: 120, clientY: 120 }]);
    act(() => {
      node.dispatchEvent(oneFinger);
    });
    expect(oneFinger.defaultPrevented).toBe(false);
    expect(setViewport).not.toHaveBeenCalled();
  });
});
