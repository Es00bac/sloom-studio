import { describe, expect, it } from 'vitest';
import type { Connection, Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import {
  normalizeImageConnectionTargetHandle,
  normalizeImageEdges,
} from './imageEdgeMigration';

function createNode(node: Partial<AppNode> & Pick<AppNode, 'id' | 'type'>): AppNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...node,
  } as AppNode;
}

describe('normalizeImageConnectionTargetHandle', () => {
  it('routes the first image-to-image connection onto the edit-source handle', () => {
    const nodes = [
      createNode({ id: 'image-source', type: 'imageGen' }),
      createNode({ id: 'image-edit', type: 'imageGen' }),
    ];
    const connection: Connection = {
      source: 'image-source',
      target: 'image-edit',
      sourceHandle: null,
      targetHandle: null,
    };

    expect(normalizeImageConnectionTargetHandle(connection, nodes, [])).toMatchObject({
      targetHandle: 'image-edit-source',
    });
  });

  it('routes later image-to-image connections onto the next open reference handle', () => {
    const nodes = [
      createNode({ id: 'image-source-1', type: 'imageGen' }),
      createNode({ id: 'image-source-2', type: 'imageGen' }),
      createNode({ id: 'image-edit', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-source',
        source: 'image-source-1',
        target: 'image-edit',
        targetHandle: 'image-edit-source',
      },
    ];
    const connection: Connection = {
      source: 'image-source-2',
      target: 'image-edit',
      sourceHandle: null,
      targetHandle: null,
    };

    expect(normalizeImageConnectionTargetHandle(connection, nodes, edges)).toMatchObject({
      targetHandle: 'image-reference-1',
    });
  });
});

describe('normalizeImageEdges', () => {
  it('repairs legacy image-to-image edges onto explicit source and reference handles', () => {
    const nodes = [
      createNode({ id: 'image-source-1', type: 'imageGen' }),
      createNode({ id: 'image-source-2', type: 'imageGen' }),
      createNode({ id: 'image-edit', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-source-1',
        target: 'image-edit',
      },
      {
        id: 'edge-2',
        source: 'image-source-2',
        target: 'image-edit',
      },
    ];

    expect(normalizeImageEdges(nodes, edges)).toEqual([
      {
        id: 'edge-1',
        source: 'image-source-1',
        target: 'image-edit',
        targetHandle: 'image-edit-source',
      },
      {
        id: 'edge-2',
        source: 'image-source-2',
        target: 'image-edit',
        targetHandle: 'image-reference-1',
      },
    ]);
  });

  it('dedupes exclusive source/reference handles so only the latest edge survives per slot', () => {
    const nodes = [
      createNode({ id: 'image-source-1', type: 'imageGen' }),
      createNode({ id: 'image-source-2', type: 'imageGen' }),
      createNode({ id: 'image-edit', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-old',
        source: 'image-source-1',
        target: 'image-edit',
        targetHandle: 'image-edit-source',
      },
      {
        id: 'edge-new',
        source: 'image-source-2',
        target: 'image-edit',
        targetHandle: 'image-edit-source',
      },
    ];

    expect(normalizeImageEdges(nodes, edges)).toEqual([
      {
        id: 'edge-new',
        source: 'image-source-2',
        target: 'image-edit',
        targetHandle: 'image-edit-source',
      },
    ]);
  });
});
