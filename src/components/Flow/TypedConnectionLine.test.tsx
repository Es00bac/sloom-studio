import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode, FlowNodeType, NodeData } from '../../types/flow';
import { resolveTypedConnectionLineState } from './TypedConnectionLine';

function node(id: string, type: FlowNodeType, data: NodeData = {}): AppNode {
  return { id, type, position: { x: 0, y: 0 }, data } as AppNode;
}

describe('resolveTypedConnectionLineState', () => {
  it('colors a valid drag from its source payload and points toward the target', () => {
    const nodes = [node('source', 'imageGen'), node('target', 'cropImageNode')];

    expect(resolveTypedConnectionLineState({
      fromNodeId: 'source',
      fromHandleId: null,
      fromHandleType: 'source',
      toNodeId: 'target',
      toHandleId: 'image',
      toHandleType: 'target',
    }, { nodes, edges: [] })).toMatchObject({
      color: '#34d399',
      invalidReason: undefined,
      markerAt: 'to',
      typeLabel: 'image',
      valid: true,
    });
  });

  it('shows the shared validator reason during an invalid drag', () => {
    const nodes = [node('source', 'textNode'), node('target', 'cropImageNode')];

    expect(resolveTypedConnectionLineState({
      fromNodeId: 'source',
      fromHandleId: null,
      fromHandleType: 'source',
      toNodeId: 'target',
      toHandleId: 'image',
      toHandleType: 'target',
    }, { nodes, edges: [] })).toMatchObject({
      color: '#f87171',
      invalidReason: 'text cannot connect to image or package or envelope<image> or envelope<package> or envelope<mixed>',
      valid: false,
    });
  });

  it('keeps data direction correct when a drag begins at a target handle', () => {
    const nodes = [node('source', 'numberNode'), node('target', 'mathNode')];
    const edges: Edge[] = [];

    expect(resolveTypedConnectionLineState({
      fromNodeId: 'target',
      fromHandleId: 'A',
      fromHandleType: 'target',
      toNodeId: 'source',
      toHandleId: null,
      toHandleType: 'source',
    }, { nodes, edges })).toMatchObject({
      markerAt: 'from',
      typeLabel: 'number',
      valid: true,
    });
  });
});
