import type { Connection, Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import {
  normalizeFlowHandle,
  resolveFlowNodePort,
  resolveFlowNodePorts,
  type FlowPortContract,
} from './flowNodeContracts';
import {
  flowDataTypeEquals,
  isFlowTypeAccepted,
  runtimeTypeFromResultType,
  type FlowDataType,
} from './flowPortTypes';
import { isFlowResultKind } from './flowValueTypes';
import {
  COMPOSITION_VIDEO_HANDLE,
  isCompositionAudioHandle,
} from './compositionTracks';
import { isPortalSyntheticEdge } from './portalNodes';

export interface FlowGraphContractContext {
  nodes: readonly AppNode[];
  edges: readonly Edge[];
}

export interface FlowConnectionValidation {
  valid: boolean;
  sourcePort?: FlowPortContract;
  targetPort?: FlowPortContract;
  carriedType?: FlowDataType;
  acceptedTypes?: readonly FlowDataType[];
  reason?: string;
  converterNodeTypes?: readonly AppNode['type'][];
}

export interface PersistedFlowEdgeContract {
  valid: boolean;
  carriedType?: FlowDataType;
  acceptedTypes?: readonly FlowDataType[];
  reason?: string;
  converterNodeTypes?: readonly AppNode['type'][];
}

type Connectable = Connection | Edge;

const unknownType: FlowDataType = { kind: 'unknown' };
const graphIndexCache = new WeakMap<object, {
  incomingByNode: Map<string, Edge[]>;
  nodeById: Map<string, AppNode>;
}>();
const outputTypeCache = new WeakMap<object, Map<string, FlowDataType>>();

export function validateFlowConnection(
  candidate: Connectable,
  context: FlowGraphContractContext,
): FlowConnectionValidation {
  const { nodeById } = getGraphIndexes(context);
  const sourceNode = nodeById.get(candidate.source);
  const targetNode = nodeById.get(candidate.target);

  if (!sourceNode) return invalid(`The source node ${candidate.source || '(missing)'} does not exist.`);
  if (!targetNode) return invalid(`The target node ${candidate.target || '(missing)'} does not exist.`);
  if (sourceNode.id === targetNode.id) return invalid('A node cannot connect to itself.');

  const sourceHandle = normalizeFlowHandle(candidate.sourceHandle);
  const targetHandle = normalizeFlowHandle(candidate.targetHandle);
  const sourcePort = resolveFlowNodePort(
    { node: sourceNode, nodes: context.nodes, edges: context.edges },
    'output',
    sourceHandle,
  );
  const targetPort = resolveFlowNodePort(
    { node: targetNode, nodes: context.nodes, edges: context.edges },
    'input',
    targetHandle,
  );

  if (!sourcePort) return invalid(`The source handle ${formatHandle(sourceHandle)} is not available on this node.`);
  if (!targetPort) return invalid(`The target handle ${formatHandle(targetHandle)} is not available on this node.`);

  const declaredCarriedType = resolveFlowOutputType(sourceNode.id, sourceHandle, context);
  const carriedType = resolveFunctionCompositionRuntimeType(
    sourceNode,
    targetNode,
    targetHandle,
  ) ?? declaredCarriedType;
  const acceptedTypes = resolveAcceptedTargetTypes(targetNode, targetPort, candidate, context);
  const common = { sourcePort, targetPort, carriedType, acceptedTypes };

  if (sourcePort.disabledReason) return invalid(sourcePort.disabledReason, common);
  if (targetPort.disabledReason) return invalid(targetPort.disabledReason, common);

  const portalSyntheticCandidate = isPortalSyntheticConnectable(candidate);

  if (targetPort.maxConnections !== null && !portalSyntheticCandidate) {
    const candidateId = 'id' in candidate ? candidate.id : undefined;
    const existingCount = context.edges.filter((edge) =>
      edge.id !== candidateId
      && !isPortalSyntheticEdge(edge)
      && edge.target === targetNode.id
      && normalizeFlowHandle(edge.targetHandle) === targetHandle
    ).length;

    if (existingCount >= targetPort.maxConnections) {
      return invalid(`${targetPort.label} already has its maximum of ${targetPort.maxConnections} connection${targetPort.maxConnections === 1 ? '' : 's'}.`, common);
    }
  }

  for (const group of portalSyntheticCandidate ? [] : targetPort.connectionGroups ?? []) {
    if (!isFlowTypeAccepted(carriedType, group.types).compatible) continue;
    const candidateId = 'id' in candidate ? candidate.id : undefined;
    const existingCount = context.edges.filter((edge) => {
      if (
        edge.id === candidateId
        || isPortalSyntheticEdge(edge)
        || edge.target !== targetNode.id
        || normalizeFlowHandle(edge.targetHandle) !== targetHandle
      ) {
        return false;
      }
      const existingType = resolveFlowOutputType(edge.source, edge.sourceHandle, context);
      return isFlowTypeAccepted(existingType, group.types).compatible;
    }).length;

    if (existingCount >= group.maxConnections) {
      return invalid(
        `${targetPort.label} already has its maximum of ${group.maxConnections} ${group.id} connection${group.maxConnections === 1 ? '' : 's'}.`,
        common,
      );
    }
  }

  const compatibility = isFlowTypeAccepted(carriedType, acceptedTypes);
  if (!compatibility.compatible) {
    return invalid(compatibility.reason ?? 'These ports carry incompatible value types.', {
      ...common,
      converterNodeTypes: compatibility.converterNodeTypes,
    });
  }

  return { valid: true, ...common };
}

function resolveFunctionCompositionRuntimeType(
  sourceNode: AppNode,
  targetNode: AppNode,
  targetHandle: string | null,
): FlowDataType | undefined {
  if (sourceNode.type !== 'functionNode' || targetNode.type !== 'composition') {
    return undefined;
  }
  const isMediaLane = targetHandle === COMPOSITION_VIDEO_HANDLE
    || isCompositionAudioHandle(targetHandle);
  if (!isMediaLane) {
    return undefined;
  }
  const resultType = sourceNode.data.resultType;
  return isFlowResultKind(resultType)
    ? runtimeTypeFromResultType(resultType)
    : unknownType;
}

function isPortalSyntheticConnectable(candidate: Connectable): boolean {
  return 'id' in candidate && isPortalSyntheticEdge(candidate);
}

export function annotateFlowEdge(edge: Edge, context: FlowGraphContractContext): Edge {
  const validation = validateFlowConnection(edge, context);
  const flowContract: PersistedFlowEdgeContract = {
    valid: validation.valid,
    carriedType: validation.carriedType,
    acceptedTypes: validation.acceptedTypes,
    reason: validation.reason,
    converterNodeTypes: validation.converterNodeTypes,
  };

  return {
    ...edge,
    type: 'typed',
    data: {
      ...(edge.data ?? {}),
      flowContract,
    },
  };
}

export function annotateFlowEdges(
  edges: readonly Edge[],
  nodes: readonly AppNode[],
): Edge[] {
  const context = { nodes, edges };
  return edges.map((edge) => annotateFlowEdge(edge, context));
}

/**
 * Determines whether a node-data edit can change any persisted edge contract. Dynamic port
 * resolvers are the primary authority, so new model/handle/type variants participate without a
 * second hand-maintained key list. The small explicit projection covers graph-wide semantics that
 * do not appear in the edited node's own port list: Portal pairing, Function runtime media family,
 * and Composition's authored-vs-routed track count.
 */
export function flowNodeConnectionContractsChanged(
  nodeId: string,
  previousNodes: readonly AppNode[],
  nextNodes: readonly AppNode[],
  edges: readonly Edge[],
): boolean {
  const previousNode = previousNodes.find((node) => node.id === nodeId);
  const nextNode = nextNodes.find((node) => node.id === nodeId);
  if (!previousNode || !nextNode) return false;

  const participatesInGraph = edges.some((edge) => edge.source === nodeId || edge.target === nodeId);
  const canAffectPortalPair = previousNode.type === 'portal' || nextNode.type === 'portal';
  if (!participatesInGraph && !canAffectPortalPair) return false;

  const normalizationSensitiveDataChanged = (
    (nextNode.type === 'composition'
      && !Object.is(previousNode.data.compositionAudioTrackCount, nextNode.data.compositionAudioTrackCount))
    || (nextNode.type === 'portal'
      && !Object.is(previousNode.data.portalPairId, nextNode.data.portalPairId))
    || (nextNode.type === 'functionNode'
      && !Object.is(previousNode.data.resultType, nextNode.data.resultType))
  );
  if (normalizationSensitiveDataChanged) {
    return true;
  }

  const previousContext = { node: previousNode, nodes: previousNodes, edges };
  const nextContext = { node: nextNode, nodes: nextNodes, edges };
  const previousPorts = resolveFlowNodePorts(previousContext);
  const nextPorts = resolveFlowNodePorts(nextContext);

  if (!contractProjectionEquals(previousPorts, nextPorts)) return true;

  const outputHandles = new Set<string | null>([
    ...previousPorts.filter((port) => port.direction === 'output').map((port) => port.id),
    ...nextPorts.filter((port) => port.direction === 'output').map((port) => port.id),
  ]);
  const previousGraphContext = { nodes: previousNodes, edges };
  const nextGraphContext = { nodes: nextNodes, edges };

  for (const handle of outputHandles) {
    if (!contractProjectionEquals(
      resolveFlowOutputType(nodeId, handle, previousGraphContext),
      resolveFlowOutputType(nodeId, handle, nextGraphContext),
    )) {
      return true;
    }
  }

  return false;
}

function contractProjectionEquals(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    // Contract projections are expected to be serializable. If a future resolver violates that
    // boundary, fail toward re-derivation rather than silently retaining an old annotation.
    return false;
  }
}

export function resolveFlowOutputType(
  nodeId: string,
  handle: string | null | undefined,
  context: FlowGraphContractContext,
  visited: ReadonlySet<string> = new Set(),
): FlowDataType {
  const normalizedHandle = normalizeFlowHandle(handle);
  const visitKey = `${nodeId}:${normalizedHandle ?? '__default__'}`;
  if (visited.has(visitKey)) return unknownType;
  const cache = getOutputTypeCache(context);
  const cached = cache.get(visitKey);
  if (cached) return cached;

  const resolved = resolveFlowOutputTypeUncached(
    nodeId,
    normalizedHandle,
    context,
    visited,
    visitKey,
  );
  cache.set(visitKey, resolved);
  return resolved;
}

function resolveFlowOutputTypeUncached(
  nodeId: string,
  normalizedHandle: string | null,
  context: FlowGraphContractContext,
  visited: ReadonlySet<string>,
  visitKey: string,
): FlowDataType {
  const node = getGraphIndexes(context).nodeById.get(nodeId);
  if (!node) return unknownType;

  const nextVisited = new Set(visited);
  nextVisited.add(visitKey);

  const passthroughHandles = passthroughInputHandles(node.type);
  if (passthroughHandles && normalizedHandle === null) {
    return resolveConsistentIncomingType(node.id, passthroughHandles, context, nextVisited);
  }

  if (node.type === 'forkSwitchNode' && (normalizedHandle === 'A' || normalizedHandle === 'B')) {
    return resolveConsistentIncomingType(node.id, ['input'], context, nextVisited);
  }

  if (node.type === 'switchCaseNode' && /^case\d+$/.test(normalizedHandle ?? '')) {
    return resolveConsistentIncomingType(node.id, ['key'], context, nextVisited);
  }

  if (node.type === 'conditionalNode' && normalizedHandle === null) {
    return resolveConsistentIncomingType(node.id, ['valueIfTrue', 'valueIfFalse'], context, nextVisited);
  }

  if (node.type === 'fallbackSelectorNode' && normalizedHandle === null) {
    return resolveConsistentIncomingType(node.id, ['primary', 'fallback'], context, nextVisited);
  }

  if (node.type === 'portal' && node.data.portalRole === 'exit' && normalizedHandle === null) {
    const pairId = node.data.portalPairId;
    const entry = context.nodes.find((candidate) =>
      candidate.type === 'portal'
      && candidate.data.portalRole === 'entry'
      && candidate.data.portalPairId === pairId
    );
    return entry
      ? resolveConsistentIncomingType(entry.id, [null], context, nextVisited)
      : unknownType;
  }

  if ((node.type === 'list' || node.type === 'envelope') && normalizedHandle === null) {
    const incomingTypes = resolveIncomingTypes(node.id, undefined, context, nextVisited);
    if (incomingTypes.length === 0) {
      const declared = resolveFlowNodePorts({ node, nodes: context.nodes, edges: context.edges })
        .find((port) => port.direction === 'output' && port.id === null)?.types;
      if (declared?.length === 1) return declared[0];
    }
    const item = consistentType(incomingTypes);
    return { kind: node.type, item: item.kind === 'unknown' ? { kind: 'mixed' } : item };
  }

  if (node.type === 'loopNode' && normalizedHandle === null) {
    const item = resolveConsistentIncomingType(node.id, [null], context, nextVisited);
    return { kind: 'list', item: item.kind === 'unknown' ? { kind: 'mixed' } : item };
  }

  if (node.type === 'arrayFlatNode' && normalizedHandle === null) {
    const containers = resolveIncomingTypes(node.id, ['L1', 'L2', 'L3'], context, nextVisited);
    const items = containers.flatMap((type) =>
      type.kind === 'list' || type.kind === 'envelope'
        ? type.item.kind === 'mixed' ? [] : [type.item]
        : []
    );
    const item = consistentType(items);
    return { kind: 'list', item: item.kind === 'unknown' ? { kind: 'mixed' } : item };
  }

  if (node.type === 'expander' && normalizedHandle === null) {
    const container = resolveConsistentIncomingType(node.id, [null], context, nextVisited);
    if (container.kind === 'list' || container.kind === 'envelope') {
      return container.item.kind === 'mixed' ? unknownType : container.item;
    }
    return unknownType;
  }

  const outputPort = resolveFlowNodePorts({ node, nodes: context.nodes, edges: context.edges })
    .find((port) => port.direction === 'output' && port.id === normalizedHandle);
  return outputPort?.types.length === 1 ? outputPort.types[0] : unknownType;
}

function resolveAcceptedTargetTypes(
  targetNode: AppNode,
  targetPort: FlowPortContract,
  candidate: Connectable,
  context: FlowGraphContractContext,
): readonly FlowDataType[] {
  if (targetNode.type === 'list' && /^list-item-\d+$/.test(targetPort.id ?? '')) {
    const existingTypes = resolveIncomingTypes(
      targetNode.id,
      undefined,
      {
        ...context,
        edges: context.edges.filter((edge) => edge.id !== ('id' in candidate ? candidate.id : undefined)),
      },
      new Set(),
    );
    const existingType = consistentType(existingTypes);
    if (existingType.kind !== 'unknown') return [existingType];
  }

  const peerHandles = peerTypedInputHandles(targetNode.type, targetPort.id);
  if (peerHandles) {
    const peerTypes = resolveIncomingTypes(targetNode.id, peerHandles, context, new Set());
    const peerType = consistentType(peerTypes);
    if (peerType.kind !== 'unknown') return [peerType];
  }

  return targetPort.types;
}

function resolveConsistentIncomingType(
  nodeId: string,
  targetHandles: readonly (string | null)[],
  context: FlowGraphContractContext,
  visited: ReadonlySet<string>,
): FlowDataType {
  return consistentType(resolveIncomingTypes(nodeId, targetHandles, context, visited));
}

function resolveIncomingTypes(
  nodeId: string,
  targetHandles: readonly (string | null)[] | undefined,
  context: FlowGraphContractContext,
  visited: ReadonlySet<string>,
): FlowDataType[] {
  return (getGraphIndexes(context).incomingByNode.get(nodeId) ?? [])
    .filter((edge) =>
      targetHandles === undefined || targetHandles.includes(normalizeFlowHandle(edge.targetHandle))
    )
    .map((edge) => resolveFlowOutputType(edge.source, edge.sourceHandle, context, visited));
}

function consistentType(types: readonly FlowDataType[]): FlowDataType {
  const concrete = types.filter((type) => type.kind !== 'unknown');
  if (concrete.length === 0) return unknownType;
  return concrete.every((type) => flowDataTypeEquals(type, concrete[0])) ? concrete[0] : unknownType;
}

function passthroughInputHandles(type: AppNode['type']): readonly (string | null)[] | undefined {
  switch (type) {
    case 'virtual':
    case 'valueMonitorNode':
      return [null];
    case 'switchNode':
    case 'loopGateNode':
      return ['input'];
    default:
      return undefined;
  }
}

function peerTypedInputHandles(
  type: AppNode['type'],
  handle: string | null,
): readonly (string | null)[] | undefined {
  if (type === 'conditionalNode') {
    if (handle === 'valueIfTrue') return ['valueIfFalse'];
    if (handle === 'valueIfFalse') return ['valueIfTrue'];
  }
  if (type === 'fallbackSelectorNode') {
    if (handle === 'primary') return ['fallback'];
    if (handle === 'fallback') return ['primary'];
  }
  if (type === 'comparisonNode') {
    if (handle === 'A') return ['B'];
    if (handle === 'B') return ['A'];
  }
  return undefined;
}

function formatHandle(handle: string | null): string {
  return handle === null ? '(default)' : `"${handle}"`;
}

function invalid(
  reason: string,
  details: Omit<FlowConnectionValidation, 'valid' | 'reason'> = {},
): FlowConnectionValidation {
  return { valid: false, reason, ...details };
}

function getGraphIndexes(context: FlowGraphContractContext): {
  incomingByNode: Map<string, Edge[]>;
  nodeById: Map<string, AppNode>;
} {
  const cacheKey = context as object;
  const cached = graphIndexCache.get(cacheKey);
  if (cached) return cached;

  const incomingByNode = new Map<string, Edge[]>();
  for (const edge of context.edges) {
    const incoming = incomingByNode.get(edge.target) ?? [];
    incoming.push(edge);
    incomingByNode.set(edge.target, incoming);
  }
  const indexes = {
    incomingByNode,
    nodeById: new Map(context.nodes.map((node) => [node.id, node])),
  };
  graphIndexCache.set(cacheKey, indexes);
  return indexes;
}

function getOutputTypeCache(context: FlowGraphContractContext): Map<string, FlowDataType> {
  const cacheKey = context as object;
  const cached = outputTypeCache.get(cacheKey);
  if (cached) return cached;
  const created = new Map<string, FlowDataType>();
  outputTypeCache.set(cacheKey, created);
  return created;
}
