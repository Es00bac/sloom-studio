// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageAutomationWorkspace } from './ImageAutomationWorkspace';
import {
  IMAGE_AUTOMATION_NODE_TYPES,
  getImageAutomationNodeEntry,
} from './imageAutomationCatalog';
import { useImageAutomationStore } from './imageAutomationStore';

const { fitViewSpy, reactFlowProps } = vi.hoisted(() => ({
  fitViewSpy: vi.fn(),
  reactFlowProps: [] as any[],
}));

vi.mock('@xyflow/react', async () => {
  return {
    Background: () => <div data-testid="image-automation-background" />,
    Controls: () => <div data-testid="image-automation-controls" />,
    ReactFlow: (props: { children?: any }) => {
      reactFlowProps.push(props);
      return <div data-testid="image-automation-react-flow">{props.children}</div>;
    },
    ReactFlowProvider: ({ children }: { children?: any }) => (
      <div data-testid="image-automation-provider">{children}</div>
    ),
    Handle: (props: { id?: string; position?: string; type?: string }) => (
      <span
        data-handle-id={props.id}
        data-handle-position={props.position}
        data-handle-type={props.type}
        data-testid="image-automation-handle"
      />
    ),
    Position: { Left: 'left', Right: 'right' },
    useReactFlow: () => ({ fitView: fitViewSpy }),
  };
});

describe('ImageAutomationWorkspace', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    fitViewSpy.mockClear();
    reactFlowProps.length = 0;
    useImageAutomationStore.getState().resetAutomationFlow();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders a visually distinct Image Automation canvas separate from the main Flow workspace', () => {
    const html = renderToStaticMarkup(<ImageAutomationWorkspace />);

    expect(html).toContain('data-image-automation-workspace="true"');
    expect(html).toContain('data-image-automation-theme="emerald-grid"');
    expect(html).toContain('data-image-automation-canvas="true"');
    expect(html).toContain('Image Automation');
    expect(html).toContain('Separate automation canvas for directory batches');
    expect(html).toContain('data-testid="image-automation-react-flow"');
  });

  it('renders a compact Image-specific node palette with batch editor automation nodes and safety warnings', () => {
    const html = renderToStaticMarkup(<ImageAutomationWorkspace />);

    expect(html).toContain('Directory Input');
    expect(html).toContain('Directory / Glob Input');
    expect(html).toContain('Image Batch List');
    expect(html).toContain('Extract Image Metadata');
    expect(html).toContain('Resize / Canvas Size');
    expect(html).toContain('Apply Adjustment');
    expect(html).toContain('Apply Image Macro');
    expect(html).toContain('AI Variable Fill Plan');
    expect(html).toContain('Save Output');
    expect(html).toContain('Package Outputs');
    expect(html).toContain('Safety:');
    expect(html).toContain('Plan only; does not call an AI provider until a runner implements execution.');
    expect(html).not.toContain('JavaScript Script');
    expect(html).not.toContain('Video</span>');
  });

  it('registers every Image Automation catalog node type while leaving the starter flow bounded', () => {
    act(() => {
      root.render(<ImageAutomationWorkspace />);
    });

    const latestReactFlowProps = reactFlowProps.at(-1);
    expect(Object.keys(latestReactFlowProps.nodeTypes)).toEqual([...IMAGE_AUTOMATION_NODE_TYPES]);
    expect(latestReactFlowProps.nodes.map((node: { type: string }) => node.type)).toEqual([
      'directoryInput',
      'imageBatchList',
      'applyAdjustment',
      'saveOutput',
    ]);
  });

  it('renders typed left and right handles plus warning text on catalog node cards', () => {
    act(() => {
      root.render(<ImageAutomationWorkspace />);
    });

    const latestReactFlowProps = reactFlowProps.at(-1);
    const NodeComponent = latestReactFlowProps.nodeTypes.applyImageMacro;
    const entry = getImageAutomationNodeEntry('applyImageMacro');
    const html = renderToStaticMarkup(
      <NodeComponent
        data={entry.initialData}
        id="macro-node"
        type="applyImageMacro"
      />,
    );

    expect(html).toContain('Inputs');
    expect(html).toContain('Image Batch');
    expect(html).toContain('AI Variables');
    expect(html).toContain('Outputs');
    expect(html).toContain('Macro Batch');
    expect(html).toContain('data-handle-id="imageBatch"');
    expect(html).toContain('data-handle-type="target"');
    expect(html).toContain('data-handle-id="macroBatch"');
    expect(html).toContain('data-handle-type="source"');
    expect(html).toContain('Uses Image macro descriptors only; no destructive pixel writes are enabled by default.');
  });

  it('refits seeded starter nodes after they exist and caps the zoom for 1080p layouts', () => {
    act(() => {
      root.render(<ImageAutomationWorkspace />);
    });

    expect(fitViewSpy).toHaveBeenCalledWith(expect.objectContaining({
      maxZoom: expect.any(Number),
      padding: expect.any(Number),
    }));

    const latestReactFlowProps = reactFlowProps.at(-1);
    expect(latestReactFlowProps.fitView).toBe(true);
    expect(latestReactFlowProps.fitViewOptions.maxZoom).toBeLessThanOrEqual(0.9);
    expect(latestReactFlowProps.nodes.map((node: { type: string }) => node.type)).toEqual([
      'directoryInput',
      'imageBatchList',
      'applyAdjustment',
      'saveOutput',
    ]);
  });
});
