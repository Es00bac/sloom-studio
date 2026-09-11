import { describe, expect, it } from 'vitest';
import type { Connection, Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import {
  normalizeVideoImageConnectionTargetHandle,
  normalizeVideoImageEdges,
  replaceExclusiveVideoFrameEdges,
} from './videoEdgeMigration';

function createNode(node: Partial<AppNode> & Pick<AppNode, 'id' | 'type'>): AppNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...node,
  } as AppNode;
}

describe('normalizeVideoImageEdges', () => {
  it('promotes a single legacy image-to-video edge to both start and end frame handles', () => {
    const nodes = [
      createNode({ id: 'image-1', type: 'imageGen' }),
      createNode({ id: 'video-1', type: 'videoGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-prompt',
      },
    ];

    expect(normalizeVideoImageEdges(nodes, edges)).toEqual([
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-start-frame',
      },
      {
        id: 'edge-1-end-frame',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-end-frame',
      },
    ]);
  });

  it('mirrors an end-frame-only image edge onto start frame so interpolation can run', () => {
    const nodes = [
      createNode({ id: 'image-1', type: 'imageGen' }),
      createNode({ id: 'video-1', type: 'videoGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-end-frame',
      },
    ];

    expect(normalizeVideoImageEdges(nodes, edges)).toEqual([
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-end-frame',
      },
      {
        id: 'edge-1-start-frame',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-start-frame',
      },
    ]);
  });

  it('keeps only the latest explicit edge for each frame handle', () => {
    const nodes = [
      createNode({ id: 'image-1', type: 'imageGen' }),
      createNode({ id: 'image-2', type: 'imageGen' }),
      createNode({ id: 'video-1', type: 'videoGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-start-frame',
      },
      {
        id: 'edge-2',
        source: 'image-2',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-start-frame',
      },
    ];

    expect(normalizeVideoImageEdges(nodes, edges)).toEqual([
      {
        id: 'edge-2',
        source: 'image-2',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-start-frame',
      },
    ]);
  });
});

describe('normalizeVideoImageConnectionTargetHandle', () => {
  it('routes a misdropped image edge to the first available frame handle', () => {
    const nodes = [
      createNode({ id: 'image-1', type: 'imageGen' }),
      createNode({ id: 'video-1', type: 'videoGen' }),
    ];
    const edges: Edge[] = [];
    const connection: Connection = {
      source: 'image-1',
      target: 'video-1',
      sourceHandle: null,
      targetHandle: 'video-prompt',
    };

    expect(normalizeVideoImageConnectionTargetHandle(connection, nodes, edges)).toEqual({
      source: 'image-1',
      target: 'video-1',
      sourceHandle: null,
      targetHandle: 'video-start-frame',
    });
  });
});

describe('replaceExclusiveVideoFrameEdges', () => {
  it('replaces the previous edge for the same explicit frame handle', () => {
    const nodes = [
      createNode({ id: 'image-1', type: 'imageGen' }),
      createNode({ id: 'image-2', type: 'imageGen' }),
      createNode({ id: 'video-1', type: 'videoGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-start-frame',
      },
      {
        id: 'edge-keep',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-end-frame',
      },
    ];
    const connection: Connection = {
      source: 'image-2',
      target: 'video-1',
      sourceHandle: null,
      targetHandle: 'video-start-frame',
    };

    expect(replaceExclusiveVideoFrameEdges(connection, nodes, edges)).toEqual([
      {
        id: 'edge-keep',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-end-frame',
      },
    ]);
  });
});
