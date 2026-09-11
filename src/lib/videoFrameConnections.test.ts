import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import {
  findMiswiredVideoImageSources,
  hasConnectedVideoFrameSource,
  resolveConnectedVideoFrameAsset,
} from './videoFrameConnections';

function createNode(node: Partial<AppNode> & Pick<AppNode, 'id' | 'type'>): AppNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...node,
  } as AppNode;
}

describe('hasConnectedVideoFrameSource', () => {
  it('treats a wired image node as connected even before it has produced a result', () => {
    const nodes = [
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: {
          mediaMode: 'generate',
        },
      }),
      createNode({
        id: 'video-1',
        type: 'videoGen',
      }),
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

    expect(hasConnectedVideoFrameSource(nodes, edges, 'video-1', ['video-end-frame'])).toBe(true);
  });
});

describe('resolveConnectedVideoFrameAsset', () => {
  it('returns the generated image result when the upstream frame node has finished', () => {
    const nodes = [
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: {
          mediaMode: 'generate',
          result: 'data:image/png;base64,AAA',
        },
      }),
      createNode({
        id: 'video-1',
        type: 'videoGen',
      }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: null,
        targetHandle: 'video-start-frame',
      },
    ];

    expect(resolveConnectedVideoFrameAsset(nodes, edges, 'video-1', ['video-start-frame'])).toBe(
      'data:image/png;base64,AAA',
    );
  });

  it('returns an imported asset URL for frame-connected image imports', () => {
    const nodes = [
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: {
          mediaMode: 'import',
          sourceAssetUrl: 'data:image/png;base64,BBB',
        },
      }),
      createNode({
        id: 'video-1',
        type: 'videoGen',
      }),
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

    expect(resolveConnectedVideoFrameAsset(nodes, edges, 'video-1', ['video-end-frame'])).toBe(
      'data:image/png;base64,BBB',
    );
  });

  it('keeps resolving a Video reference image when descriptive text is the first edge', () => {
    const nodes = [
      createNode({ id: 'description', type: 'textNode', data: { prompt: 'Use this person as the wardrobe reference.' } }),
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: { mediaMode: 'import', sourceAssetUrl: 'data:image/png;base64,REFERENCE' },
      }),
      createNode({ id: 'video-1', type: 'videoGen' }),
    ];
    const edges: Edge[] = [
      { id: 'description-edge', source: 'description', target: 'video-1', targetHandle: 'video-reference-1' },
      { id: 'image-edge', source: 'image-1', target: 'video-1', targetHandle: 'video-reference-1' },
    ];

    expect(hasConnectedVideoFrameSource(nodes, edges, 'video-1', ['video-reference-1'])).toBe(true);
    expect(resolveConnectedVideoFrameAsset(nodes, edges, 'video-1', ['video-reference-1']))
      .toBe('data:image/png;base64,REFERENCE');
  });

  it('resolves a package image on a Video frame handle', () => {
    const nodes = [
      createNode({ id: 'image-1', type: 'imageGen', data: { result: 'data:image/png;base64,PACKAGE' } }),
      createNode({ id: 'package-1', type: 'packageNode' }),
      createNode({ id: 'video-1', type: 'videoGen' }),
    ];
    const edges: Edge[] = [
      { id: 'image-package', source: 'image-1', target: 'package-1', targetHandle: 'image' },
      { id: 'package-video', source: 'package-1', target: 'video-1', targetHandle: 'video-start-frame' },
    ];

    expect(resolveConnectedVideoFrameAsset(nodes, edges, 'video-1', ['video-start-frame']))
      .toBe('data:image/png;base64,PACKAGE');
  });
});

describe('findMiswiredVideoImageSources', () => {
  it('flags image nodes connected to a non-frame video handle', () => {
    const nodes = [
      createNode({
        id: 'image-1',
        type: 'imageGen',
      }),
      createNode({
        id: 'video-1',
        type: 'videoGen',
      }),
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

    expect(findMiswiredVideoImageSources(nodes, edges, 'video-1')).toEqual([
      {
        nodeId: 'image-1',
        targetHandle: 'video-prompt',
      },
    ]);
  });
});
