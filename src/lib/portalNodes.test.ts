import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import {
  buildPortalSyntheticEdges,
  getPortalConnectionSummary,
  isPortalSyntheticEdge,
  resolvePairedPortalNode,
  resolvePortalExitSourceNode,
} from './portalNodes';

function node(id: string, type: AppNode['type'], data: AppNode['data'] = {}, x = 0): AppNode {
  return {
    id,
    type,
    position: { x, y: 0 },
    data,
  } as AppNode;
}

describe('portalNodes', () => {
  it('creates hidden logical edges from portal entry inputs to portal exit outputs', () => {
    const nodes = [
      node('text-1', 'textNode'),
      node('entry-1', 'portal', { portalRole: 'entry', portalPairId: 'pair-1' }),
      node('exit-1', 'portal', { portalRole: 'exit', portalPairId: 'pair-1' }),
      node('image-1', 'imageGen'),
      node('video-1', 'videoGen'),
    ];
    const edges: Edge[] = [
      { id: 'a', source: 'text-1', sourceHandle: 'text-output', target: 'entry-1', targetHandle: 'portal-entry' },
      { id: 'b', source: 'exit-1', sourceHandle: 'portal-exit', target: 'image-1', targetHandle: 'image-edit-source' },
      { id: 'c', source: 'exit-1', sourceHandle: 'portal-exit', target: 'video-1', targetHandle: 'video-prompt' },
    ];

    const synthetic = buildPortalSyntheticEdges(nodes, edges);

    expect(synthetic).toHaveLength(2);
    expect(synthetic[0]).toEqual(expect.objectContaining({
      source: 'text-1',
      sourceHandle: 'text-output',
      target: 'image-1',
      targetHandle: 'image-edit-source',
      hidden: true,
    }));
    expect(synthetic.every(isPortalSyntheticEdge)).toBe(true);
  });

  it('removes stale synthetic edges before rebuilding portal logic', () => {
    const nodes = [
      node('source-1', 'imageGen'),
      node('entry-1', 'portal', { portalRole: 'entry', portalPairId: 'pair-1' }),
      node('exit-1', 'portal', { portalRole: 'exit', portalPairId: 'pair-1' }),
      node('target-1', 'videoGen'),
    ];
    const edges: Edge[] = [
      { id: 'old', source: 'old-source', target: 'old-target', hidden: true, data: { portalSynthetic: true } },
      { id: 'in', source: 'source-1', target: 'entry-1' },
      { id: 'out', source: 'exit-1', target: 'target-1' },
    ];

    const synthetic = buildPortalSyntheticEdges(nodes, edges);

    expect(synthetic).toHaveLength(1);
    expect(synthetic[0].source).toBe('source-1');
    expect(synthetic[0].target).toBe('target-1');
  });

  it('resolves a portal exit back to the source connected to the paired entry', () => {
    const source = node('image-1', 'imageGen');
    const entry = node('entry-1', 'portal', { portalRole: 'entry', portalPairId: 'pair-1' });
    const exit = node('exit-1', 'portal', { portalRole: 'exit', portalPairId: 'pair-1' });
    const nodesById = new Map([source, entry, exit].map((item) => [item.id, item]));
    const edges: Edge[] = [{ id: 'edge-1', source: source.id, target: entry.id }];

    expect(resolvePairedPortalNode(entry, nodesById)).toBe(exit);
    expect(resolvePortalExitSourceNode(exit, nodesById, edges)).toBe(source);
  });

  it('summarizes visible portal connections for the node body', () => {
    const nodes = [
      node('prompt', 'textNode', { customTitle: 'Script prompt' }),
      node('entry', 'portal', { portalRole: 'entry', portalPairId: 'pair' }),
      node('exit', 'portal', { portalRole: 'exit', portalPairId: 'pair' }),
      node('image', 'imageGen', { customTitle: 'Panel render' }),
    ];
    const edges: Edge[] = [
      { id: 'in', source: 'prompt', target: 'entry' },
      { id: 'out', source: 'exit', target: 'image' },
    ];

    expect(getPortalConnectionSummary(nodes[1], nodes, edges)).toEqual({
      incomingLabels: ['Script prompt'],
      outgoingLabels: ['Panel render'],
      pairLabel: 'Portal pair',
      pairedNodeId: 'exit',
    });
  });
});
