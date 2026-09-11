import { ReactFlowProvider } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppNode } from '../../types/flow';
import { useFlowStore } from '../../store/flowStore';
import { ApiFetchNode } from './ApiFetchNode';

function requestNode(): AppNode {
  return {
    id: 'request-1',
    type: 'apiFetchNode',
    position: { x: 0, y: 0 },
    data: { url: 'https://example.test/data', method: 'GET' },
  } as AppNode;
}

describe('ApiFetchNode execution surface', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [requestNode()], edges: [] });
    useFlowStore.getState().hydratePersistedState();
  });

  it('renders the canonical store-owned Run control and live progress state', () => {
    const node = useFlowStore.getState().nodes[0];
    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ApiFetchNode
          {...node}
          data={{ ...node.data, isRunning: true, statusMessage: 'Sending GET request…' }}
          deletable
          dragging={false}
          draggable
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(node.data.onRun).toEqual(expect.any(Function));
    expect(html).toContain('Running');
    expect(html).toContain('Cancel node run');
    expect(html).toContain('Sending GET request…');
  });
});
