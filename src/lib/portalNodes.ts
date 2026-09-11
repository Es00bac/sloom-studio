import type { Edge } from '@xyflow/react';
import type { AppNode, FlowNodeType } from '../types/flow';
import { getNodeTypeLabel } from './nodeBookmarks';

export interface PortalConnectionSummary {
  incomingLabels: string[];
  outgoingLabels: string[];
  pairLabel: string;
  pairedNodeId?: string;
}

export function isPortalSyntheticEdge(edge: Edge): boolean {
  return Boolean((edge.data as { portalSynthetic?: unknown } | undefined)?.portalSynthetic);
}

export function buildPortalSyntheticEdges(nodes: AppNode[], edges: Edge[]): Edge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const visibleEdges = edges.filter((edge) => !isPortalSyntheticEdge(edge));
  const syntheticEdges: Edge[] = [];

  for (const entry of nodes) {
    if (!isPortalNode(entry, 'entry')) continue;
    const exit = resolvePairedPortalNode(entry, nodesById);
    if (!exit || !isPortalNode(exit, 'exit')) continue;

    const incomingEdges = visibleEdges.filter((edge) => edge.target === entry.id);
    const outgoingEdges = visibleEdges.filter((edge) => edge.source === exit.id);

    for (const incoming of incomingEdges) {
      for (const outgoing of outgoingEdges) {
        if (incoming.source === outgoing.target) continue;
        syntheticEdges.push({
          id: `portal-${entry.data.portalPairId}-${incoming.id}-${outgoing.id}`,
          source: incoming.source,
          sourceHandle: incoming.sourceHandle,
          target: outgoing.target,
          targetHandle: outgoing.targetHandle,
          hidden: true,
          data: {
            portalSynthetic: true,
            portalPairId: entry.data.portalPairId,
            portalEntryId: entry.id,
            portalExitId: exit.id,
            portalInputEdgeId: incoming.id,
            portalOutputEdgeId: outgoing.id,
          },
        });
      }
    }
  }

  return syntheticEdges;
}

export function normalizePortalEdges(nodes: AppNode[], edges: Edge[]): Edge[] {
  const visibleEdges = edges.filter((edge) => !isPortalSyntheticEdge(edge));
  return [...visibleEdges, ...buildPortalSyntheticEdges(nodes, visibleEdges)];
}

export function prunePortalExitEdgesForRemovedEntryLeads(
  nodes: AppNode[],
  previousEdges: Edge[],
  nextEdges: Edge[],
  removedEdgeIds: Iterable<string>,
): Edge[] {
  const removedIds = new Set(removedEdgeIds);
  if (removedIds.size === 0) {
    return nextEdges;
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const pairedExitIds = new Set<string>();

  for (const edge of previousEdges) {
    if (!removedIds.has(edge.id) || isPortalSyntheticEdge(edge)) {
      continue;
    }

    const targetNode = nodesById.get(edge.target);
    if (!targetNode || !isPortalNode(targetNode, 'entry')) {
      continue;
    }

    const exitNode = resolvePairedPortalNode(targetNode, nodesById);
    if (exitNode && isPortalNode(exitNode, 'exit')) {
      pairedExitIds.add(exitNode.id);
    }
  }

  if (pairedExitIds.size === 0) {
    return nextEdges;
  }

  return nextEdges.filter((edge) => isPortalSyntheticEdge(edge) || !pairedExitIds.has(edge.source));
}

export function resolvePairedPortalNode(
  portalNode: AppNode,
  nodesById: Map<string, AppNode>,
): AppNode | undefined {
  if (portalNode.type !== 'portal') return undefined;
  const pairId = typeof portalNode.data.portalPairId === 'string' ? portalNode.data.portalPairId : undefined;
  const role = portalNode.data.portalRole;
  if (!pairId || (role !== 'entry' && role !== 'exit')) return undefined;
  const pairedRole = role === 'entry' ? 'exit' : 'entry';

  return [...nodesById.values()].find((node) => (
    node.type === 'portal' &&
    node.data.portalPairId === pairId &&
    node.data.portalRole === pairedRole
  ));
}

export function resolvePortalExitSourceNode(
  portalExitNode: AppNode,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): AppNode | undefined {
  if (!isPortalNode(portalExitNode, 'exit')) return undefined;
  const entry = resolvePairedPortalNode(portalExitNode, nodesById);
  if (!entry || !isPortalNode(entry, 'entry')) return undefined;
  const incomingEdge = edges.find((edge) => !isPortalSyntheticEdge(edge) && edge.target === entry.id);
  return incomingEdge ? nodesById.get(incomingEdge.source) : undefined;
}

export function getPortalConnectionSummary(
  portalNode: AppNode,
  nodes: AppNode[],
  edges: Edge[],
): PortalConnectionSummary {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const paired = resolvePairedPortalNode(portalNode, nodesById);
  const entry = isPortalNode(portalNode, 'entry') ? portalNode : paired && isPortalNode(paired, 'entry') ? paired : undefined;
  const exit = isPortalNode(portalNode, 'exit') ? portalNode : paired && isPortalNode(paired, 'exit') ? paired : undefined;
  const visibleEdges = edges.filter((edge) => !isPortalSyntheticEdge(edge));
  const incomingLabels = entry
    ? visibleEdges
      .filter((edge) => edge.target === entry.id)
      .map((edge) => nodeLabel(nodesById.get(edge.source)))
      .filter(Boolean)
    : [];
  const outgoingLabels = exit
    ? visibleEdges
      .filter((edge) => edge.source === exit.id)
      .map((edge) => nodeLabel(nodesById.get(edge.target)))
      .filter(Boolean)
    : [];

  return {
    incomingLabels,
    outgoingLabels,
    pairLabel: typeof portalNode.data.portalLabel === 'string' && portalNode.data.portalLabel.trim()
      ? portalNode.data.portalLabel.trim()
      : 'Portal pair',
    pairedNodeId: paired?.id,
  };
}

function isPortalNode(node: AppNode, role?: 'entry' | 'exit'): boolean {
  if (node.type !== 'portal') return false;
  return role ? node.data.portalRole === role : true;
}

function nodeLabel(node: AppNode | undefined): string {
  if (!node) return '';
  const customTitle = typeof node.data.customTitle === 'string' ? node.data.customTitle.trim() : '';
  return customTitle || getNodeTypeLabel(node.type as FlowNodeType);
}
