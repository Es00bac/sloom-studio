import { describe, expect, it } from 'vitest';
import type { AppNode } from '../types/flow';
import { collectExportableProjectAssets } from './projectAssets';

function createNode(node: Partial<AppNode> & Pick<AppNode, 'id' | 'type'>): AppNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...node,
  } as AppNode;
}

describe('collectExportableProjectAssets', () => {
  it.each([true, false])('does not export Boolean %s as a media URL', (decision) => {
    expect(collectExportableProjectAssets([
      createNode({ id: 'bad-image', type: 'imageGen', data: { result: decision, resultType: 'boolean' } }),
      createNode({ id: 'bad-composition', type: 'composition', data: { result: decision, resultType: 'boolean' } }),
    ])).toEqual([]);
  });

  it('collects generated and imported media assets for export', () => {
    const assets = collectExportableProjectAssets([
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: {
          result: 'data:image/png;base64,AAA',
        },
      }),
      createNode({
        id: 'video-1',
        type: 'videoGen',
        data: {
          mediaMode: 'import',
          sourceAssetUrl: 'data:video/mp4;base64,BBB',
          sourceAssetName: 'clip.mp4',
          sourceAssetMimeType: 'video/mp4',
        },
      }),
      createNode({
        id: 'text-1',
        type: 'textNode',
        data: {
          prompt: 'No media here',
        },
      }),
    ]);

    expect(assets).toHaveLength(2);
    expect(assets.map((asset) => asset.fileName)).toEqual(
      expect.arrayContaining(['image-1-image.png', 'clip-mp4.mp4']),
    );
  });
});
