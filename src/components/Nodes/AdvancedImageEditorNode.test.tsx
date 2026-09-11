import { describe, expect, it } from 'vitest';
import type { AppNode } from '../../types/flow';
import { resolveAdvancedImageEditorInputs } from './AdvancedImageEditorNode';

function node(id: string, type: AppNode['type'], data: Record<string, unknown> = {}): AppNode {
  return { id, type, position: { x: 0, y: 0 }, data } as AppNode;
}

describe('AdvancedImageEditorNode connected inputs', () => {
  it('consumes and previews source, mask, and reference image handles independently', () => {
    const nodes = [
      node('source', 'imageGen', { result: 'data:image/png;base64,SOURCE' }),
      node('mask', 'imageGen', { result: 'data:image/png;base64,MASK' }),
      node('reference', 'imageGen', { result: 'data:image/png;base64,REFERENCE' }),
      node('editor', 'advancedImageEditor'),
    ];
    const edges = [
      { id: 'source-editor', source: 'source', target: 'editor', targetHandle: 'sourceImage' },
      { id: 'mask-editor', source: 'mask', target: 'editor', targetHandle: 'mask' },
      { id: 'reference-editor', source: 'reference', target: 'editor', targetHandle: 'reference' },
    ];

    expect(resolveAdvancedImageEditorInputs(nodes, edges, 'editor')).toEqual({
      sourceImage: 'data:image/png;base64,SOURCE',
      maskImage: 'data:image/png;base64,MASK',
      referenceImage: 'data:image/png;base64,REFERENCE',
    });
  });
});
