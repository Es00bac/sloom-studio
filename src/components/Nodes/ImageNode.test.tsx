import { ReactFlowProvider } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFlowStore } from '../../store/flowStore';
import { useSettingsStore } from '../../store/settingsStore';
import { ImageNode } from './ImageNode';
import type { AppNode } from '../../types/flow';

function createNode(id: string, type: AppNode['type'], data: Record<string, unknown> = {}): AppNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  } as AppNode;
}

describe('ImageNode mask painter controls', () => {
  beforeEach(() => {
    useFlowStore.setState({
      nodes: [],
      edges: [],
    });
  });

  it('shows a large mask-painting launcher for mask-aware image edit nodes', () => {
    useFlowStore.setState({
      nodes: [
        createNode('source-image', 'imageGen', {
          mediaMode: 'import',
          sourceAssetUrl: 'data:image/png;base64,U09VUkNF',
        }),
        createNode('target-image', 'imageGen'),
      ],
      edges: [
        { id: 'source-edge', source: 'source-image', target: 'target-image', targetHandle: 'image-edit-source' },
      ],
    });

    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ImageNode
          data={{
            mediaMode: 'generate',
            provider: 'stability',
            modelId: 'stable-image-edit-inpaint',
            imageOperation: 'mask-inpaint',
            onChange: () => undefined,
          }}
          deletable
          dragging={false}
          draggable
          id="target-image"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="imageGen"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(html).toContain('Paint mask');
    expect(html).toContain('Mask Image');
  });

  it('shows the outpaint workspace launcher for outpaint nodes', () => {
    useFlowStore.setState({
      nodes: [
        createNode('source-image', 'imageGen', {
          mediaMode: 'import',
          sourceAssetUrl: 'data:image/png;base64,U09VUkNF',
        }),
        createNode('target-image', 'imageGen'),
      ],
      edges: [
        { id: 'source-edge', source: 'source-image', target: 'target-image', targetHandle: 'image-edit-source' },
      ],
    });

    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ImageNode
          data={{
            mediaMode: 'generate',
            provider: 'stability',
            modelId: 'stable-image-edit-outpaint',
            imageOperation: 'outpaint',
            onChange: () => undefined,
          }}
          deletable
          dragging={false}
          draggable
          id="target-image"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="imageGen"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(html).toContain('Open outpaint workspace');
  });
});

describe('ImageNode reference handle routing', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [] });
  });

  it('places left-column references on the exterior left and right-column references on the exterior right', () => {
    useFlowStore.setState({
      nodes: [createNode('target-image', 'imageGen')],
      edges: [],
    });

    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ImageNode
          data={{
            mediaMode: 'generate',
            provider: 'bfl',
            modelId: 'flux-2-pro',
            onChange: () => undefined,
          }}
          deletable
          dragging={false}
          draggable
          id="target-image"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="imageGen"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(referenceHandleTag(html, 'image-reference-1')).toContain('react-flow__handle-left');
    expect(referenceHandleTag(html, 'image-reference-2')).toContain('react-flow__handle-right');
    expect(referenceHandleTag(html, 'image-reference-7')).toContain('react-flow__handle-left');
    expect(referenceHandleTag(html, 'image-reference-8')).toContain('react-flow__handle-right');
  });

  it('labels exterior reference targets so right-side inputs are not mistaken for the image output', () => {
    useFlowStore.setState({ nodes: [createNode('target-image', 'imageGen')], edges: [] });

    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ImageNode
          data={{ mediaMode: 'generate', provider: 'bfl', modelId: 'flux-2-pro' }}
          deletable
          dragging={false}
          draggable
          id="target-image"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="imageGen"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(referenceHandleTag(html, 'image-reference-2')).toContain('title="Reference 2 · image"');
    expect(html).toContain('data-reference-side="right"');
  });

  it('keeps every conceptual reference port visible and blocks handles beyond the model limit', () => {
    useFlowStore.setState({ nodes: [createNode('target-image', 'imageGen')], edges: [] });

    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ImageNode
          data={{ mediaMode: 'generate', provider: 'bfl', modelId: 'flux-2-pro' }}
          deletable
          dragging={false}
          draggable
          id="target-image"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="imageGen"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(referenceHandleTag(html, 'image-reference-8')).toContain('data-flow-port-disabled="false"');
    expect(referenceHandleTag(html, 'image-reference-9')).toContain('data-flow-port-disabled="true"');
    expect(referenceHandleTag(html, 'image-reference-14')).toContain('data-flow-port-disabled="true"');
    expect(referenceHandleTag(html, 'image-reference-9')).toContain('supports at most 8 reference images');
  });

  it('shows unsupported image-conditioning controls as disabled ports with reasons', () => {
    useFlowStore.setState({ nodes: [createNode('target-image', 'imageGen')], edges: [] });

    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ImageNode
          data={{ mediaMode: 'generate', provider: 'stability', modelId: 'stable-image-core' }}
          deletable
          dragging={false}
          draggable
          id="target-image"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="imageGen"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(referenceHandleTag(html, 'image-reference-1')).toContain('data-flow-port-disabled="true"');
    expect(referenceHandleTag(html, 'image-reference-14')).toContain('data-flow-port-disabled="true"');
    expect(handleTag(html, 'image-edit-source')).toContain('data-flow-port-disabled="true"');
    expect(handleTag(html, 'image-mask')).toContain('data-flow-port-disabled="true"');
    expect(html).toContain('does not support reference images');
  });
});

describe('ImageNode selected-model warnings', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [createNode('target-image', 'imageGen')], edges: [] });
  });

  it('keeps a preview image model selectable and warns that its contract can change', () => {
    const settings = useSettingsStore.getState();
    useSettingsStore.setState({ apiKeys: { ...settings.apiKeys, bfl: '' } });
    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ImageNode
          data={{ mediaMode: 'generate', provider: 'bfl', modelId: 'flux-2-klein-9b-preview' }}
          deletable dragging={false} draggable id="target-image" isConnectable
          positionAbsoluteX={0} positionAbsoluteY={0} selectable selected={false}
          type="imageGen" zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(html).toContain('FLUX.2 Klein 9B Preview is a preview model');
    expect(html).toContain('<option value="bfl" selected="">Black Forest Labs</option>');
    expect(html).toContain('Configure Black Forest Labs in Settings to run this model');
  });

  it('keeps a saved shut-down model understandable but visibly blocks execution', () => {
    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ImageNode
          data={{
            mediaMode: 'generate',
            provider: 'gemini',
            modelId: 'gemini-3.1-flash-image-preview',
            onRun: () => undefined,
          }}
          deletable dragging={false} draggable id="target-image" isConnectable
          positionAbsoluteX={0} positionAbsoluteY={0} selectable selected={false}
          type="imageGen" zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(html).toContain('Gemini 3.1 Flash Image Preview is shut down');
    expect(html).toContain('Choose gemini-3.1-flash-image to run');
    expect(html).toContain('title="Gemini 3.1 Flash Image Preview is unavailable and cannot run. Choose gemini-3.1-flash-image instead."');
    expect(html).toContain('disabled=""');
  });

  it('lists model controls that are deliberately blocked instead of silently hiding the mismatch', () => {
    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ImageNode
          data={{ mediaMode: 'generate', provider: 'stability', modelId: 'stable-image-core' }}
          deletable dragging={false} draggable id="target-image" isConnectable
          positionAbsoluteX={0} positionAbsoluteY={0} selectable selected={false}
          type="imageGen" zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(html).toContain('Unavailable model controls');
    expect(html).toContain('Negative prompt');
    expect(html).toContain('Inference steps');
    expect(html).toContain('Unsupported values are blocked and never sent');
  });
});

function referenceHandleTag(html: string, handleId: string): string {
  return handleTag(html, handleId);
}

function handleTag(html: string, handleId: string): string {
  const tag = html.match(new RegExp(`<div[^>]*data-handleid="${handleId}"[^>]*>`))?.[0];
  expect(tag, `Expected ${handleId} handle in rendered Image node`).toBeDefined();
  return tag ?? '';
}
