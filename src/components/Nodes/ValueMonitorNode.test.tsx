// @vitest-environment jsdom

import { ReactFlowProvider } from '@xyflow/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNode } from '../../types/flow';
import { useFlowStore } from '../../store/flowStore';
import { ValueMonitorNode } from './ValueMonitorNode';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function createNode(id: string, type: AppNode['type'], data: Record<string, unknown> = {}): AppNode {
  return { id, type, position: { x: 0, y: 0 }, data } as AppNode;
}

describe('ValueMonitorNode Function Boolean output', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [] });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it.each([
    [true, 'TRUE', 'Boolean True'],
    [false, 'FALSE', 'Boolean False'],
  ])('renders Function scalar %s as %s instead of missing', async (result, label, absentLabel) => {
    useFlowStore.setState({
      nodes: [
        createNode('function', 'functionNode', { result, resultType: 'boolean' }),
        createNode('monitor', 'valueMonitorNode'),
      ],
      edges: [{ id: 'function-monitor', source: 'function', target: 'monitor' }],
    });
    await act(async () => {
      root.render(
        <ReactFlowProvider>
          <ValueMonitorNode data={{}} deletable dragging={false} draggable id="monitor" isConnectable
            positionAbsoluteX={0} positionAbsoluteY={0} selectable selected={false} type="valueMonitorNode" zIndex={0} />
        </ReactFlowProvider>,
      );
    });

    expect(host.innerHTML).toContain(label);
    expect(host.innerHTML).not.toContain('Empty / No Value');
    expect(host.innerHTML).not.toContain(absentLabel);
  });
});
