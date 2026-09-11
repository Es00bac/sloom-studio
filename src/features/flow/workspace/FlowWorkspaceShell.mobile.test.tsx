// @vitest-environment jsdom
import type { ComponentType } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../../../types/flow';

const reactFlowCapture = vi.hoisted(() => ({
  fitView: vi.fn(),
  props: undefined as Record<string, unknown> | undefined,
}));

vi.mock('../../../lib/mobilePhoneInterface', () => ({
  useMobilePhoneInterfaceDescriptor: () => ({ enabled: true, surface: 'phone' }),
}));

vi.mock('@xyflow/react', async () => ({
  Background: () => <div data-testid="flow-background" />,
  ReactFlow: (props: { children?: any } & Record<string, unknown>) => {
    reactFlowCapture.props = props;
    return <div className="react-flow" data-testid="react-flow-shell">{props.children}</div>;
  },
  useReactFlow: () => ({
    fitView: reactFlowCapture.fitView,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: () => {},
  }),
  useStoreApi: () => ({ getState: () => ({ minZoom: 0.25, maxZoom: 4 }) }),
  useStore: (selector: (state: unknown) => unknown) => selector({ nodeLookup: new Map() }),
}));

import { FlowWorkspaceShell } from './FlowWorkspaceShell';

describe('FlowWorkspaceShell phone surface (MH-100)', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    reactFlowCapture.fitView.mockClear();
    reactFlowCapture.props = undefined;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  it('keeps the live React Flow canvas and exposes bounded thumb-sized actions', () => {
    const onStartFlowAutoOrganize = vi.fn();
    const onToggleDiagnostics = vi.fn();
    const onNodesChange = vi.fn();
    const node = { id: 'phone-node', type: 'textNode', position: { x: 24, y: 36 }, data: {} } as unknown as AppNode;

    act(() => {
      root!.render(
        <FlowWorkspaceShell
          blockingFlowDiagnosticCount={0}
          diagnosticsOpen={false}
          edges={[] as Edge[]}
          flowDiagnostics={[]}
          flowOrganizeJob={null}
          flowRecoveryKey="phone-flow"
          librarySearchMenu={null}
          nodeTypes={{} as Record<string, ComponentType<any>>}
          nodes={[node]}
          onCancelFlowAutoOrganize={() => {}}
          onCloseDiagnostics={() => {}}
          onCloseLibrarySearch={() => {}}
          onCollapseSelection={() => {}}
          onConnect={() => {}}
          onConnectEnd={() => {}}
          onConnectStart={() => {}}
          onCreateGroupFromSelection={() => {}}
          onDragOver={() => {}}
          onDrop={() => {}}
          onEdgesChange={() => {}}
          onNodeContextMenu={() => {}}
          onNodesChange={onNodesChange}
          onPaneClick={() => {}}
          onPaneContextMenu={() => {}}
          onSelectLibrarySearchTemplate={() => {}}
          onStartFlowAutoOrganize={onStartFlowAutoOrganize}
          onToggleDiagnostics={onToggleDiagnostics}
          selectedFlowNodeCount={0}
        />,
      );
    });

    expect(document.querySelector('[data-mobile-flow-shell="true"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="react-flow-shell"]')).not.toBeNull();
    const actions = document.querySelector('[data-mobile-flow-actions="true"]');
    expect(actions?.getAttribute('aria-label')).toBe('Flow phone actions');

    act(() => {
      (document.querySelector('[data-mobile-flow-fit="true"]') as HTMLButtonElement).click();
      ([...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Clean')) as HTMLButtonElement).click();
      ([...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Checks')) as HTMLButtonElement).click();
      (reactFlowCapture.props?.onNodesChange as (changes: unknown[]) => void)([{ id: node.id, type: 'position', position: { x: 48, y: 72 } }]);
    });

    expect(reactFlowCapture.fitView).toHaveBeenCalledWith({ duration: 150, padding: 0.18 });
    expect(onStartFlowAutoOrganize).toHaveBeenCalledTimes(1);
    expect(onToggleDiagnostics).toHaveBeenCalledTimes(1);
    expect(onNodesChange).toHaveBeenCalledWith([{ id: node.id, type: 'position', position: { x: 48, y: 72 } }]);
    expect(reactFlowCapture.props?.style).toEqual({ touchAction: 'none' });
  });
});
