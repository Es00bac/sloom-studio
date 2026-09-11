import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import {
  hasConnectedImageEditSource,
  hasConnectedImageReferenceSource,
  resolveConnectedImageEditAsset,
  resolveConnectedImageReferenceAsset,
} from './imageEditConnections';

function createNode(node: Partial<AppNode> & Pick<AppNode, 'id' | 'type'>): AppNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...node,
  } as AppNode;
}

describe('imageEditConnections', () => {
  it('treats an explicitly wired upstream image node as the edit source even before it has a rendered result', () => {
    const nodes = [
      createNode({ id: 'text-1', type: 'textNode' }),
      createNode({ id: 'image-source', type: 'imageGen' }),
      createNode({ id: 'image-edit', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-text',
        source: 'text-1',
        target: 'image-edit',
      },
      {
        id: 'edge-1',
        source: 'image-source',
        target: 'image-edit',
        targetHandle: 'image-edit-source',
      },
    ];

    expect(hasConnectedImageEditSource(nodes, edges, 'image-edit')).toBe(true);
  });

  it('returns the rendered upstream image result for the explicit edit-source handle', () => {
    const nodes = [
      createNode({
        id: 'image-source',
        type: 'imageGen',
        data: {
          result: 'data:image/png;base64,AAA',
        },
      }),
      createNode({ id: 'image-edit', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-source',
        target: 'image-edit',
        targetHandle: 'image-edit-source',
      },
    ];

    expect(resolveConnectedImageEditAsset(nodes, edges, 'image-edit')).toBe(
      'data:image/png;base64,AAA',
    );
  });

  it('returns an imported upstream image asset URL for a reference handle', () => {
    const nodes = [
      createNode({
        id: 'image-source',
        type: 'imageGen',
        data: {
          mediaMode: 'import',
          sourceAssetUrl: 'data:image/png;base64,BBB',
        },
      }),
      createNode({ id: 'image-edit', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-source',
        target: 'image-edit',
        targetHandle: 'image-reference-1',
      },
    ];

    expect(hasConnectedImageReferenceSource(nodes, edges, 'image-edit', ['image-reference-1'])).toBe(true);
    expect(resolveConnectedImageReferenceAsset(nodes, edges, 'image-edit', ['image-reference-1'])).toBe(
      'data:image/png;base64,BBB',
    );
  });

  it('keeps resolving the image when descriptive text is the first edge on a reference handle', () => {
    const nodes = [
      createNode({ id: 'reference-description', type: 'textNode', data: { prompt: 'Preserve this shirt design.' } }),
      createNode({
        id: 'image-source',
        type: 'imageGen',
        data: {
          mediaMode: 'import',
          sourceAssetUrl: 'data:image/png;base64,REFERENCE',
        },
      }),
      createNode({ id: 'image-edit', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-description',
        source: 'reference-description',
        target: 'image-edit',
        targetHandle: 'image-reference-1',
      },
      {
        id: 'edge-image',
        source: 'image-source',
        target: 'image-edit',
        targetHandle: 'image-reference-1',
      },
    ];

    expect(hasConnectedImageReferenceSource(nodes, edges, 'image-edit', ['image-reference-1'])).toBe(true);
    expect(resolveConnectedImageReferenceAsset(nodes, edges, 'image-edit', ['image-reference-1'])).toBe(
      'data:image/png;base64,REFERENCE',
    );
  });

  it('resolves the image half of a connected package source', () => {
    const nodes = [
      createNode({ id: 'image-source', type: 'imageGen', data: { result: 'data:image/png;base64,PACKAGE' } }),
      createNode({ id: 'package-source', type: 'packageNode' }),
      createNode({ id: 'image-edit', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      { id: 'image-package', source: 'image-source', target: 'package-source', targetHandle: 'image' },
      { id: 'package-edit', source: 'package-source', target: 'image-edit', targetHandle: 'image-edit-source' },
    ];

    expect(hasConnectedImageEditSource(nodes, edges, 'image-edit')).toBe(true);
    expect(resolveConnectedImageEditAsset(nodes, edges, 'image-edit')).toBe('data:image/png;base64,PACKAGE');
  });
});
