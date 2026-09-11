// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Play } from 'lucide-react';
import type { AppNode } from '../../types/flow';
import { useFlowStore } from '../../store/flowStore';
import { BaseNode } from './BaseNode';

function createNode(id: string, type: AppNode['type'], data: Record<string, unknown> = {}): AppNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  } as AppNode;
}

function createTextEnvelopeNode(id: string, values: string[]) {
  return createNode(id, 'envelope', {
    envelopeItemKind: 'text',
    envelopeItems: values.map((value, index) => ({
      id: `${id}-${index}`,
      index,
      kind: 'text',
      label: `Prompt ${index + 1}`,
      value,
    })),
  });
}

function createImageEnvelopeNode(id: string, values: string[]) {
  return createNode(id, 'envelope', {
    envelopeItemKind: 'image',
    envelopeItems: values.map((value, index) => ({
      id: `${id}-${index}`,
      index,
      kind: 'image',
      label: `Image ${index + 1}`,
      value,
      mimeType: 'image/png',
    })),
  });
}

function renderBaseNode(nodeId: string): { html: string; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(
      <ReactFlowProvider>
        <BaseNode
          nodeId={nodeId}
          nodeType="imageGen"
          icon={Play}
          title="Image"
          onRun={() => undefined}
        >
          <div>content</div>
        </BaseNode>
      </ReactFlowProvider>,
    );
  });

  return {
    html: container.innerHTML,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('BaseNode loop summary (FBL-017 follow-up)', () => {
  beforeEach(() => {
    useFlowStore.setState({
      nodes: [],
      edges: [],
      bookmarkSidebarOpen: true,
    });
  });

  afterEach(() => {
    useFlowStore.setState({
      nodes: [],
      edges: [],
      bookmarkSidebarOpen: true,
    });
  });

  it('exposes the All Combos selector and shows 6x for a 2-image × 3-prompt graph', () => {
    const imageEnvelope = createImageEnvelopeNode('image-env', [
      'data:image/png;base64,A',
      'data:image/png;base64,B',
    ]);
    const textEnvelope = createTextEnvelopeNode('text-env', ['wide', 'tall', 'square']);
    const target = createNode('target', 'imageGen', {
      mediaMode: 'generate',
      provider: 'bfl',
      modelId: 'flux-2-pro',
      listLoopMode: 'allCombinations',
    });

    useFlowStore.setState({
      nodes: [imageEnvelope, textEnvelope, target],
      edges: [
        { id: 'edge-image', source: imageEnvelope.id, target: target.id, targetHandle: 'image-edit-source' },
        { id: 'edge-text', source: textEnvelope.id, target: target.id },
      ],
    });

    const { html, unmount } = renderBaseNode(target.id);

    expect(html).toContain('All Combos');
    expect(html).toContain('6x');
    expect(html).toContain('Paired');

    unmount();
  });

  it('hides the loop selector when there is only one axis', () => {
    const textEnvelope = createTextEnvelopeNode('text-env', ['red', 'blue', 'green']);
    const target = createNode('target', 'imageGen', {
      mediaMode: 'generate',
      provider: 'bfl',
      modelId: 'flux-2-pro',
      listLoopMode: 'allCombinations',
    });

    useFlowStore.setState({
      nodes: [textEnvelope, target],
      edges: [{ id: 'edge-text', source: textEnvelope.id, target: target.id }],
    });

    const { html, unmount } = renderBaseNode(target.id);

    expect(html).not.toContain('All Combos');
    expect(html).not.toContain('Loop');

    unmount();
  });
});
