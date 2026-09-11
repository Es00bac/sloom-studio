import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import {
  hasConnectedVideoSource,
  resolveConnectedVideoSourceAsset,
} from './videoSourceConnections';

function createNode(node: Partial<AppNode> & Pick<AppNode, 'id' | 'type'>): AppNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...node,
  } as AppNode;
}

describe('video source connections', () => {
  it('detects a connected upstream video source for an image node', () => {
    const nodes = [
      createNode({ id: 'video-1', type: 'videoGen' }),
      createNode({ id: 'image-1', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'video-1',
        target: 'image-1',
      },
    ];

    expect(hasConnectedVideoSource(nodes, edges, 'image-1')).toBe(true);
  });

  it('returns the imported video asset when the source video node is in import mode', () => {
    const nodes = [
      createNode({
        id: 'video-1',
        type: 'videoGen',
        data: {
          mediaMode: 'import',
          sourceAssetUrl: 'data:video/mp4;base64,AAA',
        },
      }),
      createNode({ id: 'image-1', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'video-1',
        target: 'image-1',
      },
    ];

    expect(resolveConnectedVideoSourceAsset(nodes, edges, 'image-1')).toBe('data:video/mp4;base64,AAA');
  });

  it('returns the generated video result when available', () => {
    const nodes = [
      createNode({
        id: 'video-1',
        type: 'videoGen',
        data: {
          result: 'blob:generated-video',
        },
      }),
      createNode({ id: 'image-1', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'video-1',
        target: 'image-1',
      },
    ];

    expect(resolveConnectedVideoSourceAsset(nodes, edges, 'image-1')).toBe('blob:generated-video');
  });

  it.each([true, false])('never exposes Boolean %s as a connected video URL', (decision) => {
    const nodes = [
      createNode({ id: 'video-1', type: 'videoGen', data: { result: decision, resultType: 'boolean' } }),
      createNode({ id: 'image-1', type: 'imageGen' }),
    ];
    const edges: Edge[] = [{ id: 'edge-1', source: 'video-1', target: 'image-1' }];

    expect(resolveConnectedVideoSourceAsset(nodes, edges, 'image-1')).toBeUndefined();
  });
});
