import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import {
  resolveEffectiveSourceNode,
  resolveVirtualSourceNode,
} from './virtualNodes';

function createNode(id: string, type: AppNode['type']): AppNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {},
  } as AppNode;
}

describe('virtual node resolution', () => {
  it('resolves a virtual node to its linked upstream source node', () => {
    const source = createNode('image-1', 'imageGen');
    const virtual = createNode('virtual-1', 'virtual');
    const nodesById = new Map([source, virtual].map((node) => [node.id, node]));
    const edges: Edge[] = [{ id: 'edge-1', source: source.id, target: virtual.id }];

    expect(resolveVirtualSourceNode(virtual, nodesById, edges)).toBe(source);
    expect(resolveEffectiveSourceNode(virtual, nodesById, edges)).toBe(source);
  });

  it('follows virtual-to-virtual chains without looping forever', () => {
    const source = createNode('video-1', 'videoGen');
    const firstVirtual = createNode('virtual-1', 'virtual');
    const secondVirtual = createNode('virtual-2', 'virtual');
    const nodesById = new Map([source, firstVirtual, secondVirtual].map((node) => [node.id, node]));
    const edges: Edge[] = [
      { id: 'edge-1', source: source.id, target: firstVirtual.id },
      { id: 'edge-2', source: firstVirtual.id, target: secondVirtual.id },
    ];

    expect(resolveVirtualSourceNode(secondVirtual, nodesById, edges)).toBe(source);
  });

  it('returns undefined for cyclic virtual aliases', () => {
    const firstVirtual = createNode('virtual-1', 'virtual');
    const secondVirtual = createNode('virtual-2', 'virtual');
    const nodesById = new Map([firstVirtual, secondVirtual].map((node) => [node.id, node]));
    const edges: Edge[] = [
      { id: 'edge-1', source: firstVirtual.id, target: secondVirtual.id },
      { id: 'edge-2', source: secondVirtual.id, target: firstVirtual.id },
    ];

    expect(resolveVirtualSourceNode(firstVirtual, nodesById, edges)).toBeUndefined();
  });

  it.each([
    [true, 'A'],
    [false, 'B'],
    [undefined, 'B'],
    ['true', 'A'],
    ['false', 'B'],
  ])('routes typed and legacy Vision Verify decisions without collapsing %s', (result, activeHandle) => {
    const source = createNode('source', 'textNode');
    const decision = createNode('decision', 'visionVerifyNode');
    decision.data = result === undefined ? {} : { result, resultType: 'boolean' };
    const fork = createNode('fork', 'forkSwitchNode');
    const nodesById = new Map([source, decision, fork].map((node) => [node.id, node]));
    const edges: Edge[] = [
      { id: 'source-fork', source: source.id, target: fork.id, targetHandle: 'input' },
      { id: 'decision-fork', source: decision.id, target: fork.id, targetHandle: 'condition' },
    ];

    expect(resolveEffectiveSourceNode(fork, nodesById, edges, activeHandle)).toBe(source);
    expect(resolveEffectiveSourceNode(fork, nodesById, edges, activeHandle === 'A' ? 'B' : 'A')).toBeUndefined();
  });
});
