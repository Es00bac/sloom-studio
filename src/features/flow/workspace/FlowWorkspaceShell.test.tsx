import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import { FlowWorkspaceShell } from './FlowWorkspaceShell';
import type { AppNode } from '../../../types/flow';

const reactFlowCapture = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));

vi.mock('@xyflow/react', async () => {
  return {
    Background: () => <div data-testid="flow-background" />,
    BaseEdge: () => <path />,
    Controls: () => <div data-testid="flow-controls" />,
    ReactFlow: (props: { children?: any } & Record<string, unknown>) => {
      reactFlowCapture.props = props;
      return <div data-testid="react-flow-shell">{props.children}</div>;
    },
    getBezierPath: () => ['M 0 0 L 1 1', 0.5, 0.5],
    useReactFlow: () => ({
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      setViewport: () => {},
    }),
    useStoreApi: () => ({
      getState: () => ({ minZoom: 0.5, maxZoom: 2 }),
    }),
    useStore: (selector: (state: unknown) => unknown) => selector({ nodeLookup: new Map() }),
  };
});

describe('FlowWorkspaceShell', () => {
  it('renders a dedicated Flow canvas shell instead of keeping the logic in App.tsx', () => {
    const markup = renderToStaticMarkup(
      <FlowWorkspaceShell
        blockingFlowDiagnosticCount={0}
        diagnosticsOpen={false}
        flowDiagnostics={[]}
        flowOrganizeJob={null}
        flowRecoveryKey="flow::recovery"
        librarySearchMenu={null}
        nodeTypes={{} as Record<string, ComponentType<any>>}
        nodes={[] as AppNode[]}
        edges={[] as Edge[]}
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
        onNodesChange={() => {}}
        onPaneClick={() => {}}
        onPaneContextMenu={() => {}}
        onSelectLibrarySearchTemplate={() => {}}
        onStartFlowAutoOrganize={() => {}}
        onToggleDiagnostics={() => {}}
        onCancelFlowAutoOrganize={() => {}}
        selectedFlowNodeCount={0}
      />,
    );

    expect(markup).toContain('data-testid="flow-workspace-shell"');
    expect(markup).toContain('data-testid="react-flow-shell"');
    // Publishes the card rectangles wires clip themselves against.
    expect(markup).toContain('data-testid="flow-card-occluder-defs"');
    expect(reactFlowCapture.props).toMatchObject({
      className: expect.stringContaining('flow-wires-over-cards'),
      defaultEdgeOptions: { type: 'typed', zIndex: 10_000 },
      panOnScroll: true,
      zoomActivationKeyCode: 'Control',
      zoomOnScroll: false,
    });
    expect((reactFlowCapture.props?.edgeTypes as Record<string, unknown>)?.typed).toBeTypeOf('function');
    expect(reactFlowCapture.props?.connectionLineComponent).toBeTypeOf('function');
    expect(reactFlowCapture.props?.isValidConnection).toBeTypeOf('function');
  });

  it('reserves ordinary wheel input for panning and Control+wheel for zooming', () => {
    renderToStaticMarkup(
      <FlowWorkspaceShell
        blockingFlowDiagnosticCount={0}
        diagnosticsOpen={false}
        flowDiagnostics={[]}
        flowOrganizeJob={null}
        flowRecoveryKey="flow::wheel-navigation"
        librarySearchMenu={null}
        nodeTypes={{} as Record<string, ComponentType<any>>}
        nodes={[] as AppNode[]}
        edges={[] as Edge[]}
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
        onNodesChange={() => {}}
        onPaneClick={() => {}}
        onPaneContextMenu={() => {}}
        onSelectLibrarySearchTemplate={() => {}}
        onStartFlowAutoOrganize={() => {}}
        onToggleDiagnostics={() => {}}
        onCancelFlowAutoOrganize={() => {}}
        selectedFlowNodeCount={0}
      />,
    );

    expect(reactFlowCapture.props?.panOnScroll).toBe(true);
    expect(reactFlowCapture.props?.zoomOnScroll).toBe(false);
    expect(reactFlowCapture.props?.zoomActivationKeyCode).toBe('Control');
    // React Flow's free pan-on-scroll mode maps deltaY to vertical movement and,
    // on desktop, Shift+deltaY to horizontal movement.
    expect(reactFlowCapture.props?.panOnScrollMode).toBeUndefined();
  });

  it('is mounted by App instead of leaving the Flow canvas inline there', () => {
    const source = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('FlowWorkspaceShell');
  });
});
