import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { collectFunctionNodeWarnings } from './functionNodes';
import { validateFlowConnection } from './flowConnectionContracts';
import { resolveFlowNodePorts } from './flowNodeContracts';
import {
  collectSignalDiagnostics,
  evaluateNodeSignal,
  type FlowDiagnostic,
} from './flowSignals';

export function collectFlowDiagnostics(nodes: AppNode[], edges: Edge[]): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const graph = { nodes, edges };
  const validEdges = new Set<string>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      diagnostics.push({
        id: `broken-edge-${edge.id}`,
        edgeId: edge.id,
        severity: 'critical',
        message: 'This edge references a node that no longer exists.',
        suggestedFix: 'Delete the broken edge or reconnect it to an existing node.',
        blocksRun: true,
      });
      continue;
    }

    const validation = validateFlowConnection(edge, graph);
    if (validation.valid) {
      validEdges.add(edge.id);
      continue;
    }

    diagnostics.push({
      id: `contract-edge-${edge.id}`,
      edgeId: edge.id,
      nodeId: edge.target,
      severity: 'critical',
      message: validation.reason ?? 'This edge carries an incompatible value type.',
      suggestedFix: validation.converterNodeTypes?.length
        ? `Insert an explicit converter node: ${validation.converterNodeTypes.join(', ')}.`
        : 'Reconnect the edge to a compatible enabled input, or change the node/model configuration.',
      blocksRun: true,
    });
  }

  for (const node of nodes) {
    const ports = resolveFlowNodePorts({ node, nodes, edges });
    for (const port of ports) {
      if (port.direction !== 'input' || port.minConnections <= 0 || port.disabledReason) continue;
      const connectionCount = edges.filter((edge) =>
        validEdges.has(edge.id)
        && edge.target === node.id
        && normalizeHandle(edge.targetHandle) === port.id
      ).length;
      if (connectionCount >= port.minConnections) continue;

      diagnostics.push({
        id: `contract-required-${node.id}-${port.id ?? 'default'}`,
        nodeId: node.id,
        severity: 'critical',
        message: `${port.label} requires ${port.minConnections} connection${port.minConnections === 1 ? '' : 's'}.`,
        suggestedFix: `Connect ${port.help.replace(/\.$/, '').toLowerCase()} before running this node.`,
        blocksRun: true,
      });
    }

    diagnostics.push(...collectSignalDiagnostics(evaluateNodeSignal(node.id, nodes, edges)));

    if (node.type === 'composition' && Array.isArray(node.data.compositionAudioMigrationWarnings)) {
      diagnostics.push(...node.data.compositionAudioMigrationWarnings.map((warning, index) => ({
        id: `composition-audio-migration-${node.id}-${index}-${warning.handle}`,
        nodeId: node.id,
        severity: 'warning' as const,
        message: warning.message,
        suggestedFix: 'Reconnect this audio track to a supported handle (composition-audio-1 through composition-audio-4).',
        blocksRun: false,
      })));
    }

    if (node.type === 'functionNode' && node.data.functionNode) {
      diagnostics.push(...collectFunctionNodeWarnings(node.data.functionNode).map((message, index) => ({
        id: `function-warning-${node.id}-${index}`,
        nodeId: node.id,
        severity: 'warning' as const,
        message,
        suggestedFix: 'Open the function node and repair the missing port or internal binding.',
        blocksRun: false,
      })));
    }
  }

  return dedupeDiagnostics(diagnostics);
}

function normalizeHandle(handle: string | null | undefined): string | null {
  return handle ? handle : null;
}

export function getBlockingFlowDiagnostics(
  nodes: AppNode[],
  edges: Edge[],
  rootNodeId?: string,
): FlowDiagnostic[] {
  const blocking = collectFlowDiagnostics(nodes, edges).filter((diagnostic) => diagnostic.blocksRun);
  if (!rootNodeId) return blocking;

  const relevantNodeIds = collectUpstreamNodeIds(rootNodeId, edges);
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  return blocking.filter((diagnostic) => {
    if (diagnostic.nodeId) return relevantNodeIds.has(diagnostic.nodeId);
    if (diagnostic.edgeId) {
      const edge = edgesById.get(diagnostic.edgeId);
      return edge ? relevantNodeIds.has(edge.target) : true;
    }
    return true;
  });
}

function collectUpstreamNodeIds(rootNodeId: string, edges: Edge[]): Set<string> {
  const relevant = new Set<string>([rootNodeId]);
  const pending = [rootNodeId];
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  }

  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId) continue;
    for (const sourceId of incoming.get(nodeId) ?? []) {
      if (relevant.has(sourceId)) continue;
      relevant.add(sourceId);
      pending.push(sourceId);
    }
  }
  return relevant;
}

function dedupeDiagnostics(diagnostics: FlowDiagnostic[]): FlowDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.id}:${diagnostic.nodeId ?? ''}:${diagnostic.edgeId ?? ''}:${diagnostic.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
