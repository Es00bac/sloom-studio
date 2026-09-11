import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { buildListItemTargetHandle } from './listNodes';
import {
  LOOP_BREAK_TARGET_HANDLE,
  collectLoopBreakControls,
  shouldBreakLoopAtIteration,
} from './loopControl';

function createNode(node: Partial<AppNode> & Pick<AppNode, 'id' | 'type'>): AppNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...node,
  } as AppNode;
}

describe('loop control', () => {
  it('does not stop loops when no break control is connected', () => {
    const nodes = [
      createNode({ id: 'image', type: 'imageGen' }),
    ];

    expect(collectLoopBreakControls('image', nodes, [])).toEqual([]);
    expect(shouldBreakLoopAtIteration('image', nodes, [], 0)).toMatchObject({
      shouldBreak: false,
    });
  });

  it('stops a target node before an iteration when a connected stop condition is true', () => {
    const nodes = [
      createNode({ id: 'condition', type: 'valueNode', data: { valueKind: 'boolean', value: true } }),
      createNode({ id: 'break', type: 'loopBreakNode', data: { loopBreakReason: 'accepted face' } }),
      createNode({ id: 'image', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      { id: 'condition-break', source: 'condition', target: 'break', targetHandle: 'condition' },
      { id: 'break-image', source: 'break', target: 'image', targetHandle: LOOP_BREAK_TARGET_HANDLE },
    ];

    expect(collectLoopBreakControls('image', nodes, edges)).toHaveLength(1);
    expect(shouldBreakLoopAtIteration('image', nodes, edges, 0)).toMatchObject({
      shouldBreak: true,
      reason: 'accepted face',
      controlNodeId: 'break',
    });
  });

  it('evaluates vectorized stop conditions at the current loop iteration', () => {
    const nodes = [
      createNode({ id: 'false', type: 'valueNode', data: { valueKind: 'boolean', value: false } }),
      createNode({ id: 'true', type: 'valueNode', data: { valueKind: 'boolean', value: true } }),
      createNode({ id: 'conditions', type: 'list' }),
      createNode({ id: 'break', type: 'loopBreakNode' }),
      createNode({ id: 'image', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      { id: 'false-list', source: 'false', target: 'conditions', targetHandle: buildListItemTargetHandle(0) },
      { id: 'true-list', source: 'true', target: 'conditions', targetHandle: buildListItemTargetHandle(1) },
      { id: 'conditions-break', source: 'conditions', target: 'break', targetHandle: 'condition' },
      { id: 'break-image', source: 'break', target: 'image', targetHandle: LOOP_BREAK_TARGET_HANDLE },
    ];

    expect(shouldBreakLoopAtIteration('image', nodes, edges, 0)).toMatchObject({
      shouldBreak: false,
    });
    expect(shouldBreakLoopAtIteration('image', nodes, edges, 1)).toMatchObject({
      shouldBreak: true,
      controlNodeId: 'break',
    });
  });
});
