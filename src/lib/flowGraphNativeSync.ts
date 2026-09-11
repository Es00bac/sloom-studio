import type { Edge } from '@xyflow/react';
import type { AppNode, NodeData } from '../types/flow';
import type { FlowProjectFlowSnapshot } from './flowProjectWorkspaces';

/**
 * Flow graph channel for the unified cross-device op-sync (task #51; core in
 * [[projectSyncService]], design `docs/notes/764`). This is the **pure, runtime-free op model +
 * reducer** for the Flow workspace — the Flow analog of `sourceLibraryNativeSync.ts`. It carries only
 * serializable graph data (no canvas, no React, no store import), so it runs identically on the phone
 * authority and a served client and is trivially unit-testable.
 *
 * Versioning, the long-poll stream, and echo-loop prevention are the shared core's job
 * (`projectSyncService` + the generic subscriber); this module only describes *what changed* and how
 * to apply it. Every op is **id-addressed and idempotent**, so a redelivered or self-echoed op is a
 * no-op (the reducer returns the same state reference when nothing changes — the client uses that to
 * decide whether to re-render / re-broadcast).
 *
 * Node payloads must already be stripped of runtime data (the `stripProjectRuntimeData` subset in
 * `flowStore`: no `onChange`/`onRun`/`isRunning`/`error`/`statusMessage`/`sourceAssetUrl`). Stripping
 * happens at the emit seam in the store; re-attaching runtime data happens at the client apply seam
 * (`attachRuntimeDataToNodes`) — keeping this module free of both.
 */

export type FlowGraphNativeChange =
  /** Full graph snapshot — seed + version-gap repair. */
  | { type: 'flow-graph-snapshot'; snapshot: FlowProjectFlowSnapshot }
  /** A node was created. Idempotent: ignored if a node with this id already exists. */
  | { type: 'flow-node-added'; node: AppNode }
  /** A node was moved (typically emitted on drag-end, not every drag frame). */
  | { type: 'flow-node-moved'; nodeId: string; position: { x: number; y: number } }
  /** A node's data changed — a partial patch merged onto the existing data. */
  | { type: 'flow-node-data-updated'; nodeId: string; patch: Partial<NodeData>; unsetKeys?: string[] }
  /** A node was removed, along with any edges incident to it. */
  | { type: 'flow-node-removed'; nodeId: string }
  /** An edge (connection) was created. Idempotent: ignored if this edge id already exists. */
  | { type: 'flow-edge-added'; edge: Edge }
  /** An edge was removed. */
  | { type: 'flow-edge-removed'; edgeId: string };

/** The serializable slice of Flow state this channel syncs (no runtime/canvas data). */
export interface FlowGraphRendererState {
  nodes: AppNode[];
  edges: Edge[];
}

export const MAX_FLOW_SYNC_JSON_BYTES = 8_000_000;
const MAX_FLOW_SYNC_NODES = 4_000;
const MAX_FLOW_SYNC_EDGES = 12_000;

/** Closed, bounded wire validation before an untrusted LAN op reaches Flow's restore path. */
export function isFlowGraphNativeChange(value: unknown): value is FlowGraphNativeChange {
  if (!isRecord(value) || encodedJsonBytes(value) > MAX_FLOW_SYNC_JSON_BYTES) return false;
  switch (value.type) {
    case 'flow-graph-snapshot':
      return hasOnlyKeys(value, ['type', 'snapshot'])
        && isRecord(value.snapshot)
        && hasOnlyKeys(value.snapshot, ['version', 'nodes', 'edges'])
        && typeof value.snapshot.version === 'number'
        && Number.isFinite(value.snapshot.version)
        && Number.isInteger(value.snapshot.version)
        && value.snapshot.version >= 0
        && Array.isArray(value.snapshot.nodes)
        && value.snapshot.nodes.length <= MAX_FLOW_SYNC_NODES
        && value.snapshot.nodes.every(isWireNode)
        && Array.isArray(value.snapshot.edges)
        && value.snapshot.edges.length <= MAX_FLOW_SYNC_EDGES
        && value.snapshot.edges.every(isWireEdge);
    case 'flow-node-added':
      return hasOnlyKeys(value, ['type', 'node']) && isWireNode(value.node);
    case 'flow-node-moved':
      return hasOnlyKeys(value, ['type', 'nodeId', 'position'])
        && isSafeId(value.nodeId)
        && isPosition(value.position);
    case 'flow-node-data-updated':
      return hasOnlyKeys(value, ['type', 'nodeId', 'patch', 'unsetKeys'])
        && isSafeId(value.nodeId)
        && isRecord(value.patch)
        && isJsonValue(value.patch, 0)
        && (value.unsetKeys === undefined || (
          Array.isArray(value.unsetKeys)
          && value.unsetKeys.length <= 2_000
          && new Set(value.unsetKeys).size === value.unsetKeys.length
          && value.unsetKeys.every((key) => typeof key === 'string' && key.length > 0 && key.length <= 256)
        ));
    case 'flow-node-removed':
      return hasOnlyKeys(value, ['type', 'nodeId']) && isSafeId(value.nodeId);
    case 'flow-edge-added':
      return hasOnlyKeys(value, ['type', 'edge']) && isWireEdge(value.edge);
    case 'flow-edge-removed':
      return hasOnlyKeys(value, ['type', 'edgeId']) && isSafeId(value.edgeId);
    default:
      return false;
  }
}

/**
 * Apply one remote Flow op to the serializable graph state, purely. Returns the **same state
 * reference** when the op is a no-op (idempotent redelivery, or a move/patch/remove that targets a
 * missing or unchanged node) so callers can cheaply detect whether anything actually changed.
 */
export function applyFlowGraphNativeChange(
  state: FlowGraphRendererState,
  change: FlowGraphNativeChange,
): FlowGraphRendererState {
  switch (change.type) {
    case 'flow-graph-snapshot':
      return {
        nodes: change.snapshot.nodes.map((node) => ({ ...node })),
        edges: change.snapshot.edges.map((edge) => ({ ...edge })),
      };

    case 'flow-node-added': {
      if (state.nodes.some((node) => node.id === change.node.id)) return state;
      return { ...state, nodes: [...state.nodes, { ...change.node }] };
    }

    case 'flow-node-moved': {
      let moved = false;
      const nodes = state.nodes.map((node) => {
        if (node.id !== change.nodeId) return node;
        if (node.position.x === change.position.x && node.position.y === change.position.y) return node;
        moved = true;
        return { ...node, position: { x: change.position.x, y: change.position.y } };
      });
      return moved ? { ...state, nodes } : state;
    }

    case 'flow-node-data-updated': {
      let patched = false;
      const nodes = state.nodes.map((node) => {
        if (node.id !== change.nodeId) return node;
        const data = { ...node.data, ...change.patch };
        for (const key of change.unsetKeys ?? []) delete data[key];
        if (stableStringify(data) === stableStringify(node.data)) return node;
        patched = true;
        return { ...node, data };
      });
      return patched ? { ...state, nodes } : state;
    }

    case 'flow-node-removed': {
      const nodes = state.nodes.filter((node) => node.id !== change.nodeId);
      const edges = state.edges.filter(
        (edge) => edge.source !== change.nodeId && edge.target !== change.nodeId,
      );
      const nodesChanged = nodes.length !== state.nodes.length;
      const edgesChanged = edges.length !== state.edges.length;
      if (!nodesChanged && !edgesChanged) return state;
      return {
        nodes: nodesChanged ? nodes : state.nodes,
        edges: edgesChanged ? edges : state.edges,
      };
    }

    case 'flow-edge-added': {
      if (state.edges.some((edge) => edge.id === change.edge.id)) return state;
      return { ...state, edges: [...state.edges, { ...change.edge }] };
    }

    case 'flow-edge-removed': {
      const edges = state.edges.filter((edge) => edge.id !== change.edgeId);
      return edges.length === state.edges.length ? state : { ...state, edges };
    }
  }
}

/** Stable, key-order-independent JSON for comparing node data (which is built via spreads). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (val as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return val;
  });
}

/**
 * Derive the minimal set of granular ops that turn `prev` into `next`, by id. Operates on the
 * **already-serializable** graph (runtime data stripped) so a run's transient `isRunning`/etc. churn
 * never produces ops. This is how the emit seam stays robust to all the in-store normalization
 * (portals, list edges, exclusive video frames): we diff the post-`set` result rather than trying to
 * interpret individual xyflow `NodeChange`s. Granular (not whole-snapshot) ops keep the door open for
 * the per-object soft-locks / merge logic in the concurrency design (note 764).
 */
export function diffFlowGraphNativeChanges(
  prev: FlowGraphRendererState,
  next: FlowGraphRendererState,
): FlowGraphNativeChange[] {
  const ops: FlowGraphNativeChange[] = [];

  const prevNodes = new Map(prev.nodes.map((node) => [node.id, node]));
  const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));

  for (const id of prevNodes.keys()) {
    if (!nextNodes.has(id)) ops.push({ type: 'flow-node-removed', nodeId: id });
  }
  for (const [id, node] of nextNodes) {
    const before = prevNodes.get(id);
    if (!before) {
      ops.push({ type: 'flow-node-added', node });
      continue;
    }
    if (before.position.x !== node.position.x || before.position.y !== node.position.y) {
      ops.push({ type: 'flow-node-moved', nodeId: id, position: { x: node.position.x, y: node.position.y } });
    }
    if (stableStringify(before.data) !== stableStringify(node.data)) {
      const patch: Partial<NodeData> = {};
      for (const [key, value] of Object.entries(node.data)) {
        if (stableStringify(before.data[key]) !== stableStringify(value)) patch[key] = value;
      }
      const unsetKeys = Object.keys(before.data).filter((key) => !Object.hasOwn(node.data, key));
      ops.push({
        type: 'flow-node-data-updated',
        nodeId: id,
        patch,
        ...(unsetKeys.length ? { unsetKeys } : {}),
      });
    }
  }

  const prevEdges = new Map(prev.edges.map((edge) => [edge.id, edge]));
  const nextEdges = new Map(next.edges.map((edge) => [edge.id, edge]));
  for (const id of prevEdges.keys()) {
    if (!nextEdges.has(id)) ops.push({ type: 'flow-edge-removed', edgeId: id });
  }
  for (const [id, edge] of nextEdges) {
    if (!prevEdges.has(id)) ops.push({ type: 'flow-edge-added', edge });
  }

  return ops;
}

function isWireNode(value: unknown): value is AppNode {
  return isRecord(value)
    && isSafeId(value.id)
    && typeof value.type === 'string'
    && isPosition(value.position)
    && isRecord(value.data)
    && isJsonValue(value, 0);
}

function isWireEdge(value: unknown): value is Edge {
  return isRecord(value)
    && isSafeId(value.id)
    && isSafeId(value.source)
    && isSafeId(value.target)
    && isJsonValue(value, 0);
}

function isPosition(value: unknown): value is { x: number; y: number } {
  return isRecord(value)
    && typeof value.x === 'number' && Number.isFinite(value.x)
    && typeof value.y === 'number' && Number.isFinite(value.y);
}

function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 20_000
    && value.every((entry) => isJsonValue(entry, depth + 1));
  if (!isRecord(value) || Object.keys(value).length > 2_000) return false;
  return Object.values(value).every((entry) => isJsonValue(entry, depth + 1));
}

function encodedJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
