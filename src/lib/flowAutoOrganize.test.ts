import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';

import {
  applyFlowAiOrganizationPlan,
  autoOrganizeFlowSnapshot,
  buildFlowOrganizationPrompt,
  isFlowOrganizationResultNoop,
  parseFlowOrganizationPlanText,
} from './flowAutoOrganize';
import { isPortalSyntheticEdge } from './portalNodes';
import type { AppNode, FlowNodeType } from '../types/flow';

function node(id: string, type: FlowNodeType, x: number, y: number): AppNode {
  return {
    id,
    type,
    position: { x, y },
    data: {},
  };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

describe('flow auto organize', () => {
  it('lays out connected nodes in stable dependency columns', () => {
    const result = autoOrganizeFlowSnapshot({
      nodes: [
        node('video', 'videoGen', 900, 50),
        node('prompt', 'textNode', -120, 400),
        node('image', 'imageGen', 300, -80),
      ],
      edges: [
        edge('prompt-image', 'prompt', 'image'),
        edge('image-video', 'image', 'video'),
      ],
    }, { createId: (prefix) => `${prefix}-1` });

    const byId = new Map(result.nodes.map((candidate) => [candidate.id, candidate]));
    expect(byId.get('prompt')!.position.x).toBeLessThan(byId.get('image')!.position.x);
    expect(byId.get('image')!.position.x).toBeLessThan(byId.get('video')!.position.x);
    expect(result.summary.movedNodeCount).toBe(3);
  });

  it('replaces far direct edges with portal entry and exit nodes', () => {
    const result = autoOrganizeFlowSnapshot({
      nodes: [
        node('source', 'imageGen', 0, 0),
        node('target', 'videoGen', 1800, 0),
      ],
      edges: [
        edge('long-edge', 'source', 'target'),
      ],
    }, {
      createId: (prefix) => `${prefix}-fixed`,
      portalDistanceThreshold: 200,
    });

    const visibleEdges = result.edges.filter((candidate) => !isPortalSyntheticEdge(candidate));
    expect(result.nodes.filter((candidate) => candidate.type === 'portal').map((candidate) => candidate.data.portalRole)).toEqual([
      'entry',
      'exit',
    ]);
    expect(visibleEdges.some((candidate) => candidate.source === 'source' && candidate.target === 'target')).toBe(false);
    expect(visibleEdges.some((candidate) => candidate.source === 'source' && candidate.target.startsWith('portal-entry-'))).toBe(true);
    expect(visibleEdges.some((candidate) => candidate.source.startsWith('portal-exit-') && candidate.target === 'target')).toBe(true);
    expect(result.summary.portalPairCount).toBe(1);
  });

  it('applies Gemini layout plans without inventing new semantic edges', () => {
    const result = applyFlowAiOrganizationPlan({
      nodes: [
        node('prompt', 'textNode', 0, 0),
        node('image', 'imageGen', 100, 100),
        node('video', 'videoGen', 200, 200),
      ],
      edges: [
        edge('prompt-image', 'prompt', 'image'),
      ],
    }, {
      nodes: [
        { id: 'prompt', x: -100, y: 40 },
        { id: 'image', x: 320, y: 40 },
        { id: 'video', x: 720, y: 40 },
      ],
      portals: [
        { source: 'prompt', target: 'image', label: 'prompt to image' },
        { source: 'image', target: 'video', label: 'invented edge' },
      ],
    }, {
      createId: (prefix) => `${prefix}-fixed`,
    });

    const byId = new Map(result.nodes.map((candidate) => [candidate.id, candidate]));
    const visibleEdges = result.edges.filter((candidate) => !isPortalSyntheticEdge(candidate));

    expect(byId.get('prompt')!.position).toEqual({ x: -100, y: 40 });
    expect(byId.get('image')!.position).toEqual({ x: 320, y: 40 });
    expect(result.nodes.filter((candidate) => candidate.type === 'portal')).toHaveLength(2);
    expect(visibleEdges.some((candidate) => candidate.source === 'image' && candidate.target === 'video')).toBe(false);
    expect(result.summary.portalPairCount).toBe(1);
    expect(result.summary.ignoredPortalCount).toBe(1);
  });

  it('reports Gemini layout plans with unchanged positions as no movement', () => {
    const result = applyFlowAiOrganizationPlan({
      nodes: [
        node('prompt', 'textNode', 100, 200),
        node('image', 'imageGen', 500, 200),
      ],
      edges: [
        edge('prompt-image', 'prompt', 'image'),
      ],
    }, {
      nodes: [
        { id: 'prompt', x: 100, y: 200 },
        { id: 'image', x: 500, y: 200 },
      ],
    });

    expect(result.summary.movedNodeCount).toBe(0);
  });

  it('detects flow organization results that would not visibly change the workspace', () => {
    const result = applyFlowAiOrganizationPlan({
      nodes: [
        node('prompt', 'textNode', 100, 200),
        node('image', 'imageGen', 500, 200),
      ],
      edges: [
        edge('prompt-image', 'prompt', 'image'),
      ],
    }, {
      nodes: [
        { id: 'prompt', x: 100, y: 200 },
        { id: 'image', x: 500, y: 200 },
      ],
    });

    expect(isFlowOrganizationResultNoop(result)).toBe(true);
  });

  it('parses fenced Gemini JSON layout responses', () => {
    expect(parseFlowOrganizationPlanText('```json\n{"nodes":[{"id":"a","x":1,"y":2}],"portals":[]}\n```')).toEqual({
      nodes: [{ id: 'a', x: 1, y: 2 }],
      portals: [],
    });
  });

  it('builds a graph organization prompt with nodes and edges', () => {
    const prompt = buildFlowOrganizationPrompt({
      nodes: [
        {
          ...node('prompt', 'textNode', 0, 0),
          data: { prompt: 'make a panel' },
        },
        node('image', 'imageGen', 100, 0),
      ],
      edges: [
        edge('prompt-image', 'prompt', 'image'),
      ],
    });

    expect(prompt).toContain('"id":"prompt"');
    expect(prompt).toContain('"source":"prompt"');
    expect(prompt).toContain('Do not invent semantic edges');
    expect(prompt).toContain('Do not return the existing coordinates');
  });
});
