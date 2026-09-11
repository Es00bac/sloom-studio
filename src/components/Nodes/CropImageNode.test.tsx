import { ReactFlowProvider } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFlowStore } from '../../store/flowStore';
import { CropImageNode, CropSourcePreview } from './CropImageNode';
import type { AppNode } from '../../types/flow';

function createNode(id: string, type: AppNode['type'], data: Record<string, unknown> = {}): AppNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  } as AppNode;
}

describe('CropImageNode', () => {
  beforeEach(() => {
    useFlowStore.setState({
      nodes: [],
      edges: [],
    });
  });

  it('renders crop controls and the connected image source preview', () => {
    useFlowStore.setState({
      nodes: [
        createNode('source-image', 'imageGen', {
          mediaMode: 'import',
          result: 'data:image/png;base64,U09VUkNF',
          resultType: 'image',
        }),
        createNode('crop-1', 'cropImageNode' as AppNode['type']),
      ],
      edges: [
        { id: 'source-crop', source: 'source-image', target: 'crop-1', targetHandle: 'image' },
      ],
    });

    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <CropImageNode
          data={{
            cropXPercent: 10,
            cropYPercent: 10,
            cropWidthPercent: 80,
            cropHeightPercent: 80,
            onChange: () => undefined,
            onRun: () => undefined,
          }}
          deletable
          dragging={false}
          draggable
          id="crop-1"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="cropImageNode"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(html).toContain('Crop Image');
    expect(html).toContain('Source Image');
    expect(html).toContain('Crop Box');
    expect(html).toContain('Run');
  });

  it('anchors the crop preview overlay to the rendered source image bounds', () => {
    const html = renderToStaticMarkup(
      <CropSourcePreview
        cropStyle={{
          left: '15%',
          top: '10%',
          width: '70%',
          height: '70%',
        }}
        src="data:image/png;base64,U09VUkNF"
      />,
    );

    expect(html).toContain('data-crop-preview-frame="rendered-image"');
    expect(html).toContain('data-crop-preview-overlay="true"');
    expect(html.indexOf('data-crop-preview-frame="rendered-image"')).toBeLessThan(
      html.indexOf('data-crop-preview-overlay="true"'),
    );
  });
});
