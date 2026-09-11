import type { Edge } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { AppNode } from '../types/flow';
import {
  applyFunctionTransforms,
  buildCollapsedFunctionNode,
  createDefaultFunctionNodeConfig,
  pasteFlowClipboard,
  serializeFlowSelection,
} from './functionNodes';

function node(id: string, type: AppNode['type'], x: number, y: number, data: AppNode['data'] = {}): AppNode {
  return {
    id,
    type,
    position: { x, y },
    data,
  };
}

describe('functionNodes', () => {
  it('applies transform chains with explicit data type coercion', () => {
    const result = applyFunctionTransforms('  42 ', [
      { id: 'trim', kind: 'trim' },
      { id: 'number', kind: 'toNumber' },
      { id: 'prefix', kind: 'prefix', text: 'score=' },
    ]);

    expect(result).toBe('score=42');
  });

  it('builds a collapsed function node with boundary ports and rewired edges', () => {
    const nodes = [
      node('outside-a', 'textNode', -240, 0, { result: 'prompt', resultType: 'text' }),
      node('inside-a', 'stringTemplateNode', 0, 0, { selected: true, customTitle: 'Prompt Builder' }),
      node('inside-b', 'imageGen', 300, 0, { selected: true, result: 'data:image/png;base64,abc', resultType: 'image' }),
      node('outside-b', 'sourceBin', 640, 0),
    ].map((entry) => ({ ...entry, selected: entry.id.startsWith('inside') }));
    const edges: Edge[] = [
      { id: 'e-in', source: 'outside-a', target: 'inside-a', sourceHandle: null, targetHandle: 'template-input' },
      { id: 'e-mid', source: 'inside-a', target: 'inside-b', sourceHandle: 'text', targetHandle: 'image' },
      { id: 'e-out', source: 'inside-b', target: 'outside-b', sourceHandle: 'image', targetHandle: null },
    ];

    const collapsed = buildCollapsedFunctionNode({
      nodes,
      edges,
      createId: (prefix) => `${prefix}-id`,
      title: 'Reusable image chain',
    });

    expect(collapsed).not.toBeNull();
    expect(collapsed?.functionNode.data.functionNode?.contract.inputPorts).toHaveLength(1);
    expect(collapsed?.functionNode.data.functionNode?.contract.outputPorts).toHaveLength(1);
    expect(collapsed?.nextNodes.map((entry) => entry.id).sort()).toEqual(['functionNode-id', 'outside-a', 'outside-b']);
    expect(collapsed?.nextEdges).toEqual([
      expect.objectContaining({ source: 'outside-a', target: 'functionNode-id' }),
      expect.objectContaining({ source: 'functionNode-id', target: 'outside-b' }),
    ]);
    expect(collapsed?.functionNode.data.functionNode?.graph.nodes.map((entry) => entry.id).sort()).toEqual(['inside-a', 'inside-b']);
    expect(collapsed?.functionNode.data.functionNode?.graph.edges).toHaveLength(1);
  });

  it('collapses a selected group node by contracting its child logic, not the wrapper', () => {
    const nodes = [
      node('image-source', 'sourceBin', -320, 0, { result: 'image-a', resultType: 'image' }),
      {
        ...node('group-1', 'groupNode', -32, -80, {
          groupNode: {
            title: 'Verify then route',
            childNodeIds: ['verify', 'branch'],
            childEdgeIds: ['e-internal'],
            bounds: { x: 0, y: 0, width: 520, height: 220 },
            collapsed: false,
          },
        }),
        selected: true,
      },
      node('verify', 'visionVerifyNode', 0, 0, { result: 'true', resultType: 'text' }),
      node('branch', 'conditionalNode', 280, 0, { result: 'character present', resultType: 'text' }),
      node('list-output', 'list', 640, 0),
    ];
    const edges: Edge[] = [
      { id: 'e-input', source: 'image-source', target: 'verify', sourceHandle: 'image', targetHandle: 'image' },
      { id: 'e-internal', source: 'verify', target: 'branch', sourceHandle: 'result', targetHandle: 'condition' },
      { id: 'e-output', source: 'branch', target: 'list-output', sourceHandle: 'text', targetHandle: 'list-item-0' },
    ];

    const collapsed = buildCollapsedFunctionNode({
      nodes,
      edges,
      createId: (prefix) => `${prefix}-id`,
      title: 'Character appears in scene',
    });

    expect(collapsed).not.toBeNull();
    expect(collapsed?.nextNodes.map((entry) => entry.id).sort()).toEqual(['functionNode-id', 'image-source', 'list-output']);
    expect(collapsed?.functionNode.data.functionNode?.graph.nodes.map((entry) => entry.id).sort()).toEqual(['branch', 'verify']);
    expect(collapsed?.functionNode.data.functionNode?.contract.inputPorts).toHaveLength(1);
    expect(collapsed?.functionNode.data.functionNode?.contract.outputPorts).toHaveLength(1);
    expect(collapsed?.nextEdges).toEqual([
      expect.objectContaining({ source: 'image-source', target: 'functionNode-id' }),
      expect.objectContaining({ source: 'functionNode-id', target: 'list-output' }),
    ]);
  });

  it('deduplicates shared outside inputs into one reusable function input', () => {
    const nodes = [
      node('character-sheet', 'sourceBin', -320, 0, { result: 'image-a', resultType: 'image' }),
      { ...node('verify-a', 'visionVerifyNode', 0, -80, { result: 'true', resultType: 'text' }), selected: true },
      { ...node('verify-b', 'visionVerifyNode', 0, 120, { result: 'false', resultType: 'text' }), selected: true },
      { ...node('join', 'list', 320, 0, { result: '["try again"]', resultType: 'list' }), selected: true },
      node('outside-list', 'list', 640, 0),
    ];
    const edges: Edge[] = [
      { id: 'e-shared-a', source: 'character-sheet', target: 'verify-a', sourceHandle: 'image', targetHandle: 'image' },
      { id: 'e-shared-b', source: 'character-sheet', target: 'verify-b', sourceHandle: 'image', targetHandle: 'image' },
      { id: 'e-a-join', source: 'verify-a', target: 'join', sourceHandle: 'result', targetHandle: 'list-item-0' },
      { id: 'e-b-join', source: 'verify-b', target: 'join', sourceHandle: 'result', targetHandle: 'list-item-1' },
      { id: 'e-output', source: 'join', target: 'outside-list', sourceHandle: 'result', targetHandle: 'list-item-0' },
    ];

    const collapsed = buildCollapsedFunctionNode({
      nodes,
      edges,
      createId: (prefix) => `${prefix}-id`,
      title: 'Verify character assets',
    });

    expect(collapsed).not.toBeNull();
    expect(collapsed?.functionNode.data.functionNode?.contract.inputPorts).toHaveLength(1);
    expect(collapsed?.functionNode.data.functionNode?.contract.inputPorts[0]).toMatchObject({
      resultType: 'image',
      label: 'Character Sheet Image',
    });
    expect(collapsed?.nextEdges.filter((edge) => edge.source === 'character-sheet' && edge.target === 'functionNode-id')).toHaveLength(1);
  });

  it('serializes and pastes selected nodes with new ids and remapped internal edges', () => {
    const nodes = [
      { ...node('a', 'textNode', 10, 20, { prompt: 'A' }), selected: true },
      { ...node('b', 'imageGen', 310, 20, { prompt: 'B' }), selected: true },
      node('c', 'sourceBin', 620, 20),
    ];
    const edges: Edge[] = [
      { id: 'e-ab', source: 'a', target: 'b' },
      { id: 'e-bc', source: 'b', target: 'c' },
    ];

    const clipboard = serializeFlowSelection(nodes, edges);
    const pasted = pasteFlowClipboard({
      clipboard,
      existingNodes: nodes,
      existingEdges: edges,
      position: { x: 1000, y: 500 },
      createId: (prefix) => `${prefix}-copy`,
    });

    expect(pasted.nodes).toHaveLength(2);
    expect(pasted.edges).toHaveLength(1);
    expect(pasted.edges[0]).toMatchObject({ source: 'textNode-copy', target: 'imageGen-copy' });
    expect(pasted.nextEdges.some((edge) => edge.id === 'e-ab')).toBe(true);
    expect(pasted.nextEdges.some((edge) => edge.id === 'edge-copy')).toBe(true);
  });

  it('creates a default function config with editable flow constant expression bindings', () => {
    const config = createDefaultFunctionNodeConfig('Reusable branch');

    expect(config.schemaVersion).toBe(1);
    expect(config.inputBindings[0].source.mode).toBe('flow');
    expect(config.inputBindings[1].source.mode).toBe('constant');
    expect(config.inputBindings[2].source.mode).toBe('expression');
  });
});
