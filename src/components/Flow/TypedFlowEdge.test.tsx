import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EdgeProps } from '@xyflow/react';
import {
  getFlowEdgePresentation,
  type FlowEdgeContractData,
} from './flowEdgePresentation';
import { TypedFlowEdge } from './TypedFlowEdge';
import { FlowCardOcclusionProvider } from './FlowCardOcclusion';
import { FLOW_CARD_OCCLUDER_CLIP_ID } from './flowCardOcclusion';

const flowStub = vi.hoisted(() => ({
  internalNodes: new Map<string, unknown>(),
}));

vi.mock('@xyflow/react', () => ({
  BaseEdge: ({ label, markerEnd, style, ...props }: Record<string, unknown>) => (
    <path
      {...props}
      data-edge-label={typeof label === 'string' ? label : undefined}
      data-testid="base-edge"
      markerEnd={markerEnd as string}
      style={style as React.CSSProperties}
    />
  ),
  getBezierPath: () => ['M 0 0 C 25 0 75 100 100 100', 50, 50],
  useInternalNode: (id: string) => flowStub.internalNodes.get(id),
  useStore: (selector: (state: unknown) => unknown) =>
    selector({ nodeLookup: new Map(flowStub.internalNodes) }),
}));

function internalNode(x: number, y: number, width = 260, height = 140) {
  return { internals: { positionAbsolute: { x, y } }, measured: { height, width } };
}

function edgeProps(data: FlowEdgeContractData, overrides: Partial<EdgeProps> = {}): EdgeProps {
  return {
    id: 'edge-1',
    source: 'source',
    target: 'target',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: 'right' as EdgeProps['sourcePosition'],
    targetPosition: 'left' as EdgeProps['targetPosition'],
    data: { flowContract: data },
    ...overrides,
  };
}

describe('getFlowEdgePresentation', () => {
  it('uses the carried payload color and a target arrow', () => {
    expect(getFlowEdgePresentation({
      valid: true,
      carriedType: { kind: 'image' },
    })).toMatchObject({
      color: '#34d399',
      markerAtTarget: true,
      pattern: 'solid',
      typeLabel: 'image',
    });
  });

  it('adds a non-color pattern for typed containers and control values', () => {
    expect(getFlowEdgePresentation({
      valid: true,
      carriedType: { kind: 'list', item: { kind: 'text' } },
    })).toMatchObject({ color: '#22d3ee', pattern: 'container', dashArray: '8 4 2 4' });
    expect(getFlowEdgePresentation({
      valid: true,
      carriedType: { kind: 'control' },
    })).toMatchObject({ color: '#e2e8f0', pattern: 'control', dashArray: '3 3' });
  });

  it('renders invalid saved edges as red dashed warnings while retaining their type label', () => {
    expect(getFlowEdgePresentation({
      valid: false,
      carriedType: { kind: 'text' },
      reason: 'text cannot connect to image',
    })).toMatchObject({
      color: '#f87171',
      dashArray: '6 4',
      invalid: true,
      typeLabel: 'text',
    });
  });
});

describe('TypedFlowEdge', () => {
  it('renders a directional marker, accessible description, and selected type label', () => {
    const markup = renderToStaticMarkup(
      <svg>
        <TypedFlowEdge {...edgeProps({ valid: true, carriedType: { kind: 'video' } }, { selected: true })} />
      </svg>,
    );

    expect(markup).toContain('marker-end="url(#typed-flow-arrow-edge-1)"');
    expect(markup).toContain('data-edge-label="video"');
    expect(markup).toContain('aria-label="video flows from source to target"');
    expect(markup).toContain('stroke:#60a5fa');
  });

  it('preserves a user label and exposes an invalid reason', () => {
    const markup = renderToStaticMarkup(
      <svg>
        <TypedFlowEdge {...edgeProps({
          valid: false,
          carriedType: { kind: 'text' },
          reason: 'text cannot connect to image',
        }, { label: 'My edge' })} />
      </svg>,
    );

    expect(markup).toContain('data-edge-label="My edge"');
    expect(markup).toContain('aria-label="Invalid connection: text cannot connect to image"');
    expect(markup).toContain('stroke-dasharray:6 4');
  });

  it('draws the wire under unrelated cards and above the two cards it connects', () => {
    flowStub.internalNodes.set('source', internalNode(0, 0));
    flowStub.internalNodes.set('target', internalNode(600, 240));

    const markup = renderToStaticMarkup(
      <FlowCardOcclusionProvider>
        <svg>
          <TypedFlowEdge {...edgeProps({ valid: true, carriedType: { kind: 'image' } })} />
        </svg>
      </FlowCardOcclusionProvider>,
    );

    // Main body is cut out of every card rectangle on the canvas...
    expect(markup).toContain(`clip-path="url(#${FLOW_CARD_OCCLUDER_CLIP_ID})"`);
    // ...and a second copy is clipped back in over its own two cards.
    expect(markup).toContain('clip-path="url(#sl-flow-edge-cards-edge-1)"');
    expect(markup).toContain('data-testid="typed-flow-edge-attached-path"');
    expect(markup.match(/<rect/g)).toHaveLength(2);

    flowStub.internalNodes.clear();
  });

  it('renders a single unclipped wire when the canvas publishes no card occluders', () => {
    const markup = renderToStaticMarkup(
      <svg>
        <TypedFlowEdge {...edgeProps({ valid: true, carriedType: { kind: 'image' } })} />
      </svg>,
    );

    expect(markup).not.toContain('clip-path');
    expect(markup).not.toContain('typed-flow-edge-attached-path');
  });
});
