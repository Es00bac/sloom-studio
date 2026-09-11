import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { resolvePortalExitSourceNode } from './portalNodes';

export function resolveVirtualSourceNode(
  virtualNode: AppNode,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): AppNode | undefined {
  if (virtualNode.type !== 'virtual') {
    return virtualNode;
  }

  const sourceId = resolveVirtualSourceNodeId(virtualNode.id, nodesById, edges, new Set());
  return sourceId ? nodesById.get(sourceId) : undefined;
}

export function resolveEffectiveSourceNode(
  sourceNode: AppNode,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
  sourceHandle?: string | null,
): AppNode | undefined {
  return resolveEffectiveSourceNodeInternal(sourceNode, nodesById, edges, new Set(), sourceHandle);
}

function getConditionNodeValue(
  node: AppNode,
  _nodesById: Map<string, AppNode>,
  _edges: Edge[],
  visited: Set<string>,
): boolean {
  if (visited.has(node.id)) return false;
  visited.add(node.id);

  if (node.type === 'logicNode' || node.type === 'comparisonNode' || node.type === 'visionVerifyNode') {
    const result = node.data.result;
    if (result === true) return true;
    if (result === false) return false;
    const res = typeof result === 'string' ? result.toLowerCase().trim() : '';
    return res === 'true' || res === '1';
  }
  if (node.type === 'textNode') {
    const mode = node.data.mode ?? 'prompt';
    const val = String((mode === 'generate' ? node.data.result : node.data.prompt) || '').toLowerCase().trim();
    return val === 'true' || val === '1';
  }
  if (node.type === 'switchNode') {
    return node.data.state === 'on';
  }
  return false;
}

function resolveEffectiveSourceNodeInternal(
  sourceNode: AppNode,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
  visited: Set<string>,
  sourceHandle?: string | null,
): AppNode | undefined {
  if (visited.has(sourceNode.id)) {
    return undefined;
  }
  visited.add(sourceNode.id);

  if (sourceNode.type === 'switchNode') {
    const conditionEdge = edges.find((edge) => edge.target === sourceNode.id && edge.targetHandle === 'condition');
    let isOff = sourceNode.data.state === 'off';
    if (conditionEdge) {
      const conditionSource = nodesById.get(conditionEdge.source);
      if (conditionSource) {
        const resolvedCond = resolveVirtualSourceNode(conditionSource, nodesById, edges);
        if (resolvedCond) {
          const condVal = getConditionNodeValue(resolvedCond, nodesById, edges, new Set(visited));
          isOff = !condVal;
        }
      }
    }

    if (isOff) {
      return undefined; // Disconnected!
    }

    const incomingEdge = edges.find((edge) => edge.target === sourceNode.id && edge.targetHandle !== 'condition');
    if (!incomingEdge) {
      return undefined;
    }
    const incomingSource = nodesById.get(incomingEdge.source);
    return incomingSource
      ? resolveEffectiveSourceNodeInternal(incomingSource, nodesById, edges, visited, incomingEdge.sourceHandle)
      : undefined;
  }

  if (sourceNode.type === 'forkSwitchNode') {
    const conditionEdge = edges.find((edge) => edge.target === sourceNode.id && edge.targetHandle === 'condition');
    let activeOutput = sourceNode.data.selectedOutput ?? 'A';
    if (conditionEdge) {
      const conditionSource = nodesById.get(conditionEdge.source);
      if (conditionSource) {
        const resolvedCond = resolveVirtualSourceNode(conditionSource, nodesById, edges);
        if (resolvedCond) {
          const condVal = getConditionNodeValue(resolvedCond, nodesById, edges, new Set(visited));
          activeOutput = condVal ? 'A' : 'B';
        }
      }
    }

    // If the edge was connected to the inactive output, disconnect the path!
    if (sourceHandle && sourceHandle !== activeOutput) {
      return undefined;
    }

    const incomingEdge = edges.find((edge) => edge.target === sourceNode.id && edge.targetHandle !== 'condition');
    if (!incomingEdge) {
      return undefined;
    }
    const incomingSource = nodesById.get(incomingEdge.source);
    return incomingSource
      ? resolveEffectiveSourceNodeInternal(incomingSource, nodesById, edges, visited, incomingEdge.sourceHandle)
      : undefined;
  }

  if (sourceNode.type === 'virtual') {
    return resolveVirtualSourceNode(sourceNode, nodesById, edges);
  }

  if (sourceNode.type === 'portal') {
    const portalSource = resolvePortalExitSourceNode(sourceNode, nodesById, edges);
    return portalSource ? resolveEffectiveSourceNodeInternal(portalSource, nodesById, edges, visited, sourceHandle) : undefined;
  }

  if (sourceNode.type === 'valueMonitorNode') {
    const incomingEdge = edges.find((edge) => edge.target === sourceNode.id);
    if (!incomingEdge) {
      return sourceNode;
    }
    const incomingSource = nodesById.get(incomingEdge.source);
    return incomingSource
      ? resolveEffectiveSourceNodeInternal(incomingSource, nodesById, edges, visited, incomingEdge.sourceHandle)
      : sourceNode;
  }

  return sourceNode;
}

export function resolveVirtualSourceNodeId(
  virtualNodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
  visited: Set<string> = new Set(),
): string | undefined {
  if (visited.has(virtualNodeId)) {
    return undefined;
  }

  visited.add(virtualNodeId);

  const virtualNode = nodesById.get(virtualNodeId);

  if (virtualNode?.type !== 'virtual') {
    return virtualNodeId;
  }

  const incomingEdge = edges.find((edge) => edge.target === virtualNodeId);

  if (!incomingEdge) {
    return undefined;
  }

  const sourceNode = nodesById.get(incomingEdge.source);

  if (!sourceNode) {
    return undefined;
  }

  if (sourceNode.type === 'virtual') {
    return resolveVirtualSourceNodeId(sourceNode.id, nodesById, edges, visited);
  }

  if (sourceNode.type === 'portal') {
    const portalSource = resolvePortalExitSourceNode(sourceNode, nodesById, edges);
    return portalSource ? resolveVirtualSourceNodeId(portalSource.id, nodesById, edges, visited) : undefined;
  }

  return sourceNode.id;
}

export function resolveSourceNodeId(originNodeId?: string): string | undefined {
  if (!originNodeId) {
    return undefined;
  }

  const indexedMatch = originNodeId.match(/^(.*):(\d+)$/);
  return indexedMatch ? indexedMatch[1] : originNodeId;
}
