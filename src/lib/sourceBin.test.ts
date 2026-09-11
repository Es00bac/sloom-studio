import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { buildSourceBinItem, collectGlobalSourceBinItems, collectSourceBinItems, resolveMediaNodeAsset } from './sourceBin';

function createNode(node: Partial<AppNode> & Pick<AppNode, 'id' | 'type'>): AppNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...node,
  } as AppNode;
}

describe('buildSourceBinItem', () => {
  it('preserves a named subtitle output as a reusable caption asset', () => {
    const item = buildSourceBinItem(createNode({
      id: 'scribe-1',
      type: 'transcriptionNode',
      data: {
        namedOutputs: {
          'captions-vtt': {
            result: 'signal-loom-asset://captions-1',
            resultType: 'text',
            assetKind: 'subtitle',
            sourceBinItemId: 'captions-1',
            mimeType: 'text/vtt',
            fileName: 'captions.vtt',
          },
        },
      },
    }), undefined, undefined, 'captions-vtt');

    expect(item).toMatchObject({
      kind: 'subtitle',
      assetUrl: 'signal-loom-asset://captions-1',
      sourceBinItemId: 'captions-1',
      mimeType: 'text/vtt',
      label: 'captions.vtt',
    });
  });

  it('preserves Voice Isolation output as a reusable generated audio asset', () => {
    const item = buildSourceBinItem(createNode({
      id: 'isolate-1',
      type: 'audioProcessNode',
      data: {
        namedOutputs: {
          'isolated-audio': {
            result: 'signal-loom-asset://isolated-1',
            resultType: 'audio',
            assetKind: 'audio',
            sourceBinItemId: 'isolated-1',
            mimeType: 'audio/mpeg',
            fileName: 'isolated-dialogue.mp3',
          },
        },
      },
    }), undefined, undefined, 'isolated-audio');

    expect(item).toMatchObject({
      kind: 'audio',
      assetUrl: 'signal-loom-asset://isolated-1',
      sourceBinItemId: 'isolated-1',
      mimeType: 'audio/mpeg',
      label: 'isolated-dialogue.mp3',
    });
  });

  it.each([true, false])('never accepts Boolean %s as a media asset URL', (decision) => {
    const node = createNode({ id: 'bad-image', type: 'imageGen', data: { result: decision, resultType: 'boolean' } });

    expect(resolveMediaNodeAsset(node)).toBeUndefined();
    expect(buildSourceBinItem(node)).toBeUndefined();
  });

  it('extracts prompt text from prompt-mode text nodes', () => {
    const item = buildSourceBinItem(
      createNode({
        id: 'text-1',
        type: 'textNode',
        data: {
          mode: 'prompt',
          prompt: 'Hello world',
        },
      }),
    );

    expect(item).toMatchObject({
      kind: 'text',
      text: 'Hello world',
    });
  });

  it('extracts imported image assets from image nodes', () => {
    const item = buildSourceBinItem(
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: {
          mediaMode: 'import',
          sourceAssetUrl: 'data:image/png;base64,AAA',
          sourceAssetName: 'portrait.png',
        },
      }),
    );

    expect(item).toMatchObject({
      kind: 'image',
      assetUrl: 'data:image/png;base64,AAA',
      label: 'portrait.png',
    });
  });

  it('extracts cropped image outputs as reusable image assets', () => {
    const item = buildSourceBinItem(
      createNode({
        id: 'crop-1',
        type: 'cropImageNode' as AppNode['type'],
        data: {
          result: 'data:image/png;base64,Q1JPUFBFRA==',
          resultType: 'image',
        },
      }),
    );

    expect(item).toMatchObject({
      kind: 'image',
      assetUrl: 'data:image/png;base64,Q1JPUFBFRA==',
      label: 'Cropped image',
      mimeType: 'image/png',
    });
  });

  it('represents image-sequence composition ZIP outputs as packages', () => {
    const item = buildSourceBinItem(
      createNode({
        id: 'composition-1',
        type: 'composition',
        data: {
          result: 'blob:image-sequence-zip',
          resultType: 'package',
          resultMimeType: 'application/zip',
        },
      }),
    );

    expect(item).toMatchObject({
      kind: 'package',
      label: 'Composition package',
      assetUrl: 'blob:image-sequence-zip',
      mimeType: 'application/zip',
    });
  });

  it('keeps normal composition outputs as video compositions', () => {
    const item = buildSourceBinItem(
      createNode({
        id: 'composition-1',
        type: 'composition',
        data: {
          result: 'blob:composition-video',
          resultType: 'video',
          resultMimeType: 'video/webm',
        },
      }),
    );

    expect(item).toMatchObject({
      kind: 'composition',
      label: 'Composition output',
      assetUrl: 'blob:composition-video',
      mimeType: 'video/webm',
    });
  });

  it('materializes every direct source-compatible output family', () => {
    const image = createNode({ id: 'image', type: 'imageGen', data: { result: 'data:image/png;base64,IMAGE' } });
    const text = createNode({ id: 'text', type: 'textNode', data: { prompt: 'shirt campaign' } });
    const packageNode = createNode({ id: 'package', type: 'packageNode', data: { customTitle: 'Campaign package' } });
    const doodle = createNode({ id: 'doodle', type: 'doodleNode', data: { doodleDescription: 'logo placement', doodleSketch: 'data:image/png;base64,DOODLE' } });
    const slimg = createNode({ id: 'slimg', type: 'slimgNode', data: { result: 'data:image/png;base64,SLIMG' } });
    const palette = createNode({ id: 'palette', type: 'colorSwatchNode', data: { colorSwatchColors: ['#112233'] } });
    const nodes = [image, text, packageNode, doodle, slimg, palette];
    const edges: Edge[] = [
      { id: 'image-package', source: 'image', target: 'package', targetHandle: 'image' },
      { id: 'text-package', source: 'text', target: 'package', targetHandle: 'text' },
    ];

    expect(buildSourceBinItem(packageNode, nodes, edges)).toMatchObject({
      kind: 'package', assetUrl: 'data:image/png;base64,IMAGE', text: 'shirt campaign',
    });
    expect(buildSourceBinItem(doodle, nodes, edges)).toMatchObject({
      kind: 'package', assetUrl: 'data:image/png;base64,DOODLE', text: 'logo placement',
    });
    expect(buildSourceBinItem(slimg, nodes, edges)).toMatchObject({ kind: 'image', assetUrl: 'data:image/png;base64,SLIMG' });
    expect(buildSourceBinItem(palette, nodes, edges)).toMatchObject({ kind: 'text', text: expect.stringContaining('#112233') });
  });
});

describe('collectSourceBinItems', () => {
  it('returns only connected source items for a source bin', () => {
    const nodes = [
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: {
          result: 'data:image/png;base64,AAA',
        },
      }),
      createNode({
        id: 'audio-1',
        type: 'audioGen',
        data: {
          result: 'data:audio/mpeg;base64,BBB',
        },
      }),
      createNode({ id: 'bin-1', type: 'sourceBin' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'bin-1',
      },
      {
        id: 'edge-2',
        source: 'audio-1',
        target: 'bin-1',
      },
    ];

    expect(collectSourceBinItems(nodes, edges, 'bin-1')).toHaveLength(2);
  });

  it('treats multiple source bins as entry points into one global pool', () => {
    const nodes = [
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
          result: 'data:video/mp4;base64,BBB',
        },
      }),
      createNode({ id: 'bin-1', type: 'sourceBin' }),
      createNode({ id: 'bin-2', type: 'sourceBin' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'bin-1',
      },
      {
        id: 'edge-2',
        source: 'video-1',
        target: 'bin-2',
      },
    ];

    expect(collectSourceBinItems(nodes, edges, 'bin-1')).toHaveLength(2);
    expect(collectSourceBinItems(nodes, edges, 'bin-2')).toHaveLength(2);
  });
});

describe('collectGlobalSourceBinItems', () => {
  it('deduplicates a source asset connected into multiple bins', () => {
    const nodes = [
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: {
          result: 'data:image/png;base64,AAA',
        },
      }),
      createNode({ id: 'bin-1', type: 'sourceBin' }),
      createNode({ id: 'bin-2', type: 'sourceBin' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'bin-1',
      },
      {
        id: 'edge-2',
        source: 'image-1',
        target: 'bin-2',
      },
    ];

    expect(collectGlobalSourceBinItems(nodes, edges)).toHaveLength(1);
  });

  it('ingests generator node connected directly to source-bin as a single plain item, ignoring envelopeItems', () => {
    const nodes = [
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: {
          result: 'data:image/png;base64,AAA',
          envelopeItems: [
            {
              id: 'image-1-envelope-0',
              index: 0,
              kind: 'image',
              label: 'Image 1',
              value: 'data:image/png;base64,AAA',
              mimeType: 'image/png',
            },
          ],
        },
      }),
      createNode({ id: 'bin-1', type: 'sourceBin' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'bin-1',
      },
    ];

    expect(collectGlobalSourceBinItems(nodes, edges)).toEqual([
      expect.objectContaining({
        id: 'source-image-1',
        kind: 'image',
        label: 'Image',
        assetUrl: 'data:image/png;base64,AAA',
      }),
    ]);
  });

  it('expands a generator node\'s multi-result BATCH (2+ envelopeItems) into all N connected items', () => {
    const nodes = [
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: {
          result: 'data:image/png;base64,AAA',
          envelopeItems: [
            { id: 'image-1-envelope-0', index: 0, kind: 'image', label: 'Image 1', value: 'data:image/png;base64,AAA', mimeType: 'image/png', sourceBinItemId: 'sb-a' },
            { id: 'image-1-envelope-1', index: 1, kind: 'image', label: 'Image 2', value: 'data:image/png;base64,BBB', mimeType: 'image/png', sourceBinItemId: 'sb-b' },
            { id: 'image-1-envelope-2', index: 2, kind: 'image', label: 'Image 3', value: 'data:image/png;base64,CCC', mimeType: 'image/png', sourceBinItemId: 'sb-c' },
          ],
        },
      }),
      createNode({ id: 'bin-1', type: 'sourceBin' }),
    ];
    const edges: Edge[] = [{ id: 'edge-1', source: 'image-1', target: 'bin-1' }];

    const items = collectGlobalSourceBinItems(nodes, edges);
    // All three batch results are surfaced (so the source-bin reconciliation keeps them, not just the first).
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.sourceBinItemId)).toEqual(['sb-a', 'sb-b', 'sb-c']);
  });

  it('expands envelope outputs into individually draggable source-bin items when explicitly routed through an envelope node', () => {
    const nodes = [
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: {
          envelopeItems: [
            {
              id: 'image-1-envelope-0',
              index: 0,
              kind: 'image',
              label: 'Image 1',
              value: 'data:image/png;base64,AAA',
              mimeType: 'image/png',
            },
            {
              id: 'image-1-envelope-1',
              index: 1,
              kind: 'image',
              label: 'Image 2',
              value: 'data:image/png;base64,BBB',
              mimeType: 'image/png',
            },
          ],
        },
      }),
      createNode({ id: 'envelope-1', type: 'envelope' }),
      createNode({ id: 'bin-1', type: 'sourceBin' }),
    ];
    const edges: Edge[] = [
      {
        id: 'edge-1',
        source: 'image-1',
        target: 'envelope-1',
      },
      {
        id: 'edge-2',
        source: 'envelope-1',
        target: 'bin-1',
      },
    ];

    expect(collectGlobalSourceBinItems(nodes, edges)).toEqual([
      expect.objectContaining({
        id: 'source-image-1-envelope-0',
        kind: 'image',
        label: 'Image 1',
        assetUrl: 'data:image/png;base64,AAA',
        envelopeId: 'envelope-1',
        envelopeIndex: 0,
      }),
      expect.objectContaining({
        id: 'source-image-1-envelope-1',
        kind: 'image',
        label: 'Image 2',
        assetUrl: 'data:image/png;base64,BBB',
        envelopeId: 'envelope-1',
        envelopeIndex: 1,
      }),
    ]);
  });

  it('expands package node outputs with both image values and prefilled text prompts in the source bin items', () => {
    const nodes = [
      createNode({
        id: 'text-1',
        type: 'textNode',
        data: { prompt: 'My Package Prompt text' },
      }),
      createNode({
        id: 'image-1',
        type: 'imageGen',
        data: { result: 'data:image/png;base64,AAA' },
      }),
      createNode({
        id: 'pkg-1',
        type: 'packageNode',
        data: { customTitle: 'Custom Package Name' },
      }),
      createNode({ id: 'envelope-1', type: 'envelope' }),
      createNode({ id: 'bin-1', type: 'sourceBin' }),
    ];
    const edges: Edge[] = [
      { id: 'edge-t', source: 'text-1', target: 'pkg-1', targetHandle: 'text' },
      { id: 'edge-i', source: 'image-1', target: 'pkg-1', targetHandle: 'image' },
      { id: 'edge-p', source: 'pkg-1', target: 'envelope-1' },
      { id: 'edge-b', source: 'envelope-1', target: 'bin-1' },
    ];

    expect(collectGlobalSourceBinItems(nodes, edges)).toEqual([
      expect.objectContaining({
        id: 'source-pkg-1-single-0',
        kind: 'package',
        label: 'Custom Package Name',
        assetUrl: 'data:image/png;base64,AAA',
        text: 'My Package Prompt text',
        envelopeId: 'envelope-1',
        envelopeIndex: 0,
      }),
    ]);
  });

  it('filters unsupported values from mixed containers instead of unsafe-casting them into library items', () => {
    const nodes = [
      createNode({
        id: 'envelope-1',
        type: 'envelope',
        data: {
          envelopeItems: [
            { id: 'text', index: 0, kind: 'text', label: 'Caption', value: 'Demo campaign' },
            { id: 'number', index: 1, kind: 'number', label: 'Seed', value: '42' },
            { id: 'json', index: 2, kind: 'json', label: 'Metadata', value: '{"demo":true}' },
          ],
        },
      }),
      createNode({ id: 'bin-1', type: 'sourceBin' }),
    ];
    const edges: Edge[] = [{ id: 'edge', source: 'envelope-1', target: 'bin-1' }];

    expect(collectGlobalSourceBinItems(nodes, edges)).toEqual([
      expect.objectContaining({ kind: 'text', text: 'Demo campaign' }),
    ]);
  });
});
