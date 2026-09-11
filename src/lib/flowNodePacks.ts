import type { Edge } from '@xyflow/react';
import type { AppNode, FlowNodeType, NodeData } from '../types/flow';
import { validateFlowConnection } from './flowConnectionContracts';
import { getNodeCatalogEntry } from './nodeCatalog';
import {
  buildContractValidationData,
  resolveCollisionFreeTemplatePosition,
  STARTER_TEMPLATE_NODE_BOX,
  type FlowStarterTemplateInsertPayload,
  type TemplatePlacementNode,
} from './flowStarterTemplates';
import {
  API_REQUESTER_PERSISTED_CREDENTIAL_MARKER,
  isApiRequesterCredentialFieldName,
  isApiRequesterSensitiveHeaderName,
} from './apiRequesterCredentials';

/**
 * Shareable Flow node packs (MH-097).
 *
 * A node pack is a portable, versioned JSON document describing a selection of
 * Flow nodes and their internal edges so a graph (or a reusable custom node)
 * can be shared with someone else and installed onto any canvas.
 *
 * Safety contract:
 * - Export strips all runtime/transient node-data keys and redacts
 *   credential-bearing API Requester fields with the exact persisted marker.
 * - Import fails closed on unknown formats/versions, unknown node types,
 *   non-finite positions, dangling or self-referencing edges, oversized
 *   documents, and any edge that violates the live typed connection contract.
 * - Installation re-uses the store's single-set insertTemplate action at a
 *   collision-free anchor, so installing a pack is one atomic, undoable step
 *   under the Flow history boundary.
 */

export const FLOW_NODE_PACK_FORMAT = 'sloom-flow-node-pack';
export const FLOW_NODE_PACK_SCHEMA_VERSION = 1;

export const FLOW_NODE_PACK_MAX_BYTES = 5_000_000;
export const FLOW_NODE_PACK_MAX_NODES = 200;
export const FLOW_NODE_PACK_MAX_EDGES = 400;
const FLOW_NODE_PACK_MAX_NAME_LENGTH = 120;
const FLOW_NODE_PACK_MAX_DESCRIPTION_LENGTH = 500;

export interface FlowNodePackNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: NodeData;
}

export interface FlowNodePackEdge {
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
}

export interface FlowNodePackDocument {
  format: typeof FLOW_NODE_PACK_FORMAT;
  version: typeof FLOW_NODE_PACK_SCHEMA_VERSION;
  pack: {
    name: string;
    description: string;
    createdAt: string;
    nodeCount: number;
    edgeCount: number;
  };
  nodes: FlowNodePackNode[];
  edges: FlowNodePackEdge[];
}

export type FlowNodePackResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Runtime/transient node-data keys that must never travel in a pack. */
const RUNTIME_PACK_NODE_DATA_KEYS = new Set([
  'onChange',
  'onRun',
  'onSelectAttempt',
  'isRunning',
  'retryState',
  'error',
  'statusMessage',
  'result',
  'resultType',
  'resultMimeType',
  'resultExtension',
  'resultFileName',
  'resultOutputMetadata',
  'functionOutputs',
  'namedOutputs',
  'resultHistory',
  'selectedResultId',
  'resultInputSignature',
  'usage',
  'sourceAssetUrl',
  'sourceAssetId',
  'nodeInstanceId',
  'inputRevision',
  'expandedItemIndex',
  'loopBreakReason',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function freshPackId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function stripRuntimePackNodeData(data: NodeData): NodeData {
  const next: NodeData = {};
  for (const [key, value] of Object.entries(data)) {
    if (!RUNTIME_PACK_NODE_DATA_KEYS.has(key) && value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

function redactCredentialValue(): string {
  return API_REQUESTER_PERSISTED_CREDENTIAL_MARKER;
}

function redactApiRequesterUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.username) url.username = redactCredentialValue();
    if (url.password) url.password = redactCredentialValue();
    for (const [key] of url.searchParams) {
      if (isApiRequesterCredentialFieldName(key)) {
        url.searchParams.set(key, redactCredentialValue());
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function redactApiRequesterBody(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) return rawBody;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    const redactJson = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(redactJson);
      if (!isRecord(value)) return value;
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
        key,
        isApiRequesterCredentialFieldName(key) ? redactCredentialValue() : redactJson(entry),
      ]));
    };
    return JSON.stringify(redactJson(parsed));
  } catch {
    if (!rawBody.includes('=')) return rawBody;
    return rawBody.split('&').map((part) => {
      const separator = part.indexOf('=');
      if (separator < 0) return part;
      const rawKey = part.slice(0, separator);
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch {
        // Malformed keys are left untouched; this is export redaction, not request parsing.
      }
      return isApiRequesterCredentialFieldName(key)
        ? `${rawKey}=${redactCredentialValue()}`
        : part;
    }).join('&');
  }
}

/** Mirror the store's persistence redaction so packs never carry credentials. */
function redactPackNodeData(node: FlowNodePackNode): NodeData {
  const data = node.data;
  const modelCardValues = isRecord(data.modelCardValues)
    ? Object.fromEntries(Object.entries(data.modelCardValues).map(([key, value]) => [
        key,
        isApiRequesterCredentialFieldName(key) ? redactCredentialValue() : value,
      ]))
    : data.modelCardValues;
  const safeData: NodeData = {
    ...data,
    ...(modelCardValues === undefined ? {} : { modelCardValues }),
  };
  if (node.type !== 'apiFetchNode') return safeData;

  const headers = typeof safeData.headers === 'string'
    ? safeData.headers.split(/\r?\n/).map((line) => {
      const separator = line.indexOf(':');
      if (separator < 0) return line;
      const name = line.slice(0, separator).trim();
      return isApiRequesterSensitiveHeaderName(name)
        ? `${name}: ${redactCredentialValue()}`
        : line;
    }).join('\n')
    : safeData.headers;
  const url = typeof safeData.url === 'string' ? redactApiRequesterUrl(safeData.url) : safeData.url;
  const body = typeof safeData.body === 'string' ? redactApiRequesterBody(safeData.body) : safeData.body;
  return { ...safeData, headers, url, body };
}

export function buildFlowNodePack(input: {
  nodes: AppNode[];
  edges: Edge[];
  name: string;
  description?: string;
}): FlowNodePackResult<FlowNodePackDocument> {
  const selectedNodes = input.nodes.filter((node) => node.selected);
  const name = input.name.trim().slice(0, FLOW_NODE_PACK_MAX_NAME_LENGTH);
  if (!name) {
    return { ok: false, reason: 'A node pack needs a name.' };
  }
  if (selectedNodes.length === 0) {
    return { ok: false, reason: 'Select at least one node to export as a node pack.' };
  }
  if (selectedNodes.length > FLOW_NODE_PACK_MAX_NODES) {
    return { ok: false, reason: `A node pack can hold at most ${FLOW_NODE_PACK_MAX_NODES} nodes.` };
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const selectedEdges = input.edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  if (selectedEdges.length > FLOW_NODE_PACK_MAX_EDGES) {
    return { ok: false, reason: `A node pack can hold at most ${FLOW_NODE_PACK_MAX_EDGES} connections.` };
  }

  // Normalize positions to the selection's top-left so the pack anchors cleanly
  // at any import position.
  const minX = Math.min(...selectedNodes.map((node) => node.position.x));
  const minY = Math.min(...selectedNodes.map((node) => node.position.y));

  // Stable pack-local ids keep the document readable and make references
  // deterministic across exports of the same selection.
  const idMap = new Map<string, string>();
  for (const node of selectedNodes) {
    idMap.set(node.id, `pack-node-${freshPackId()}`);
  }

  const nodes: FlowNodePackNode[] = selectedNodes.map((node) => {
    const stripped: FlowNodePackNode = {
      id: idMap.get(node.id)!,
      type: node.type,
      position: {
        x: Number((node.position.x - minX).toFixed(2)),
        y: Number((node.position.y - minY).toFixed(2)),
      },
      data: stripRuntimePackNodeData(node.data),
    };
    return { ...stripped, data: redactPackNodeData(stripped) };
  });

  const edges: FlowNodePackEdge[] = selectedEdges.map((edge) => ({
    source: idMap.get(edge.source)!,
    target: idMap.get(edge.target)!,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
  }));

  const description = (input.description ?? '').trim().slice(0, FLOW_NODE_PACK_MAX_DESCRIPTION_LENGTH);
  return {
    ok: true,
    value: {
      format: FLOW_NODE_PACK_FORMAT,
      version: FLOW_NODE_PACK_SCHEMA_VERSION,
      pack: {
        name,
        description,
        createdAt: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
      nodes,
      edges,
    },
  };
}

export function serializeFlowNodePack(document: FlowNodePackDocument): string {
  return JSON.stringify(document, null, 2);
}

export function parseFlowNodePack(raw: string): FlowNodePackResult<FlowNodePackDocument> {
  if (raw.length > FLOW_NODE_PACK_MAX_BYTES) {
    return { ok: false, reason: 'This node pack is too large to import.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'This file is not valid JSON, so it cannot be a node pack.' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'A node pack must be a JSON object.' };
  }
  if (parsed.format !== FLOW_NODE_PACK_FORMAT) {
    return { ok: false, reason: 'This file is not a Sloom Flow node pack.' };
  }
  if (parsed.version !== FLOW_NODE_PACK_SCHEMA_VERSION) {
    return { ok: false, reason: `Unsupported node pack version ${String(parsed.version)}; this app reads version ${FLOW_NODE_PACK_SCHEMA_VERSION}.` };
  }
  const packMeta = isRecord(parsed.pack) ? parsed.pack : undefined;
  if (!packMeta || typeof packMeta.name !== 'string' || !packMeta.name.trim()) {
    return { ok: false, reason: 'The node pack is missing a name.' };
  }
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    return { ok: false, reason: 'The node pack contains no nodes.' };
  }
  if (parsed.nodes.length > FLOW_NODE_PACK_MAX_NODES) {
    return { ok: false, reason: `A node pack can hold at most ${FLOW_NODE_PACK_MAX_NODES} nodes.` };
  }
  if (!Array.isArray(parsed.edges)) {
    return { ok: false, reason: 'The node pack is missing its connections list.' };
  }
  if (parsed.edges.length > FLOW_NODE_PACK_MAX_EDGES) {
    return { ok: false, reason: `A node pack can hold at most ${FLOW_NODE_PACK_MAX_EDGES} connections.` };
  }

  const nodes: FlowNodePackNode[] = [];
  const seenIds = new Set<string>();
  for (const candidate of parsed.nodes) {
    if (!isRecord(candidate)) {
      return { ok: false, reason: 'Every node in a node pack must be an object.' };
    }
    if (typeof candidate.id !== 'string' || !candidate.id || candidate.id.length > 200) {
      return { ok: false, reason: 'A node in the pack has an invalid id.' };
    }
    if (seenIds.has(candidate.id)) {
      return { ok: false, reason: `Duplicate node id ${candidate.id} in the pack.` };
    }
    seenIds.add(candidate.id);
    const type = candidate.type;
    if (typeof type !== 'string' || !getNodeCatalogEntry(type as FlowNodeType)) {
      return { ok: false, reason: `The pack contains an unknown node type ${String(type)}, which this app cannot install.` };
    }
    const position = candidate.position;
    if (!isRecord(position) || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return { ok: false, reason: `Node ${candidate.id} has a non-finite position.` };
    }
    const data = isRecord(candidate.data)
      ? stripRuntimePackNodeData(candidate.data as NodeData)
      : {};
    nodes.push({
      id: candidate.id,
      type: type as FlowNodeType,
      position: { x: position.x as number, y: position.y as number },
      data,
    });
  }

  const edges: FlowNodePackEdge[] = [];
  for (const candidate of parsed.edges) {
    if (!isRecord(candidate)) {
      return { ok: false, reason: 'Every connection in a node pack must be an object.' };
    }
    const source = candidate.source;
    const target = candidate.target;
    if (typeof source !== 'string' || typeof target !== 'string' || !seenIds.has(source) || !seenIds.has(target)) {
      return { ok: false, reason: 'A connection in the pack references a node that is not in the pack.' };
    }
    if (source === target) {
      return { ok: false, reason: 'A connection in the pack connects a node to itself.' };
    }
    const sourceHandle = candidate.sourceHandle;
    const targetHandle = candidate.targetHandle;
    if (sourceHandle !== undefined && sourceHandle !== null && typeof sourceHandle !== 'string') {
      return { ok: false, reason: 'A connection in the pack has an invalid source handle.' };
    }
    if (targetHandle !== undefined && targetHandle !== null && typeof targetHandle !== 'string') {
      return { ok: false, reason: 'A connection in the pack has an invalid target handle.' };
    }
    edges.push({ source, target, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null });
  }

  // Validate every edge against the live typed connection contract, seeding the
  // same provider/model defaults the store's initial node data seeds.
  const contractNodes: AppNode[] = nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { ...node.position },
    data: buildContractValidationData(node.type, node.data),
  }));
  const validatedEdges: Edge[] = [];
  for (const edge of edges) {
    const candidate: Edge = {
      id: `pack-candidate-${validatedEdges.length}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    };
    const validation = validateFlowConnection(candidate, { nodes: contractNodes, edges: validatedEdges });
    if (!validation.valid) {
      return {
        ok: false,
        reason: `Connection ${edge.source} -> ${edge.target} violates the connection contract: ${validation.reason ?? 'incompatible ports'}.`,
      };
    }
    validatedEdges.push(candidate);
  }

  return {
    ok: true,
    value: {
      format: FLOW_NODE_PACK_FORMAT,
      version: FLOW_NODE_PACK_SCHEMA_VERSION,
      pack: {
        name: packMeta.name.trim().slice(0, FLOW_NODE_PACK_MAX_NAME_LENGTH),
        description: typeof packMeta.description === 'string'
          ? packMeta.description.trim().slice(0, FLOW_NODE_PACK_MAX_DESCRIPTION_LENGTH)
          : '',
        createdAt: typeof packMeta.createdAt === 'string' ? packMeta.createdAt : '',
        nodeCount: nodes.length,
        edgeCount: edges.length,
      },
      nodes,
      edges,
    },
  };
}

/**
 * Build the insertTemplate payload for an already-validated pack. Portal pair
 * ids are regenerated per install so an imported pair never collides with an
 * existing pair, and positions travel relative to the insertion anchor.
 */
export function buildFlowNodePackInsertPayload(
  document: FlowNodePackDocument,
): FlowStarterTemplateInsertPayload {
  const pairIdMap = new Map<string, string>();
  const freshPortalPairId = (original: unknown): unknown => {
    if (typeof original !== 'string' || !original) return original;
    const existing = pairIdMap.get(original);
    if (existing) return existing;
    const fresh = `portal-pair-${freshPackId()}`;
    pairIdMap.set(original, fresh);
    return fresh;
  };

  return {
    nodes: document.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { ...node.position },
      data: node.type === 'portal'
        ? {
          ...node.data,
          portalPairId: freshPortalPairId(node.data.portalPairId) as NodeData['portalPairId'],
        }
        : { ...node.data },
    })),
    edges: document.edges.map((edge, index) => ({
      id: `pack-edge-${index}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
    })),
  };
}

/** Collision-free anchor for installing a pack near a requested canvas point. */
export function resolveCollisionFreeNodePackPosition(
  document: FlowNodePackDocument,
  existingNodes: readonly TemplatePlacementNode[],
  requested: { x: number; y: number },
): { x: number; y: number } {
  const asTemplate = {
    id: 'node-pack',
    title: document.pack.name,
    description: document.pack.description,
    tags: [],
    nodes: document.nodes.map((node) => ({
      key: node.id,
      type: node.type,
      position: { ...node.position },
      data: node.data,
    })),
    edges: document.edges.map((edge) => ({
      from: edge.source,
      fromHandle: edge.sourceHandle,
      to: edge.target,
      toHandle: edge.targetHandle,
    })),
  };
  return resolveCollisionFreeTemplatePosition(asTemplate, existingNodes, requested);
}

/** Pack footprint on the canvas (estimate used for centering after install). */
export function getFlowNodePackBounds(document: FlowNodePackDocument): { width: number; height: number } {
  const maxX = Math.max(...document.nodes.map((node) => node.position.x + STARTER_TEMPLATE_NODE_BOX.width));
  const maxY = Math.max(...document.nodes.map((node) => node.position.y + STARTER_TEMPLATE_NODE_BOX.height));
  const minX = Math.min(...document.nodes.map((node) => node.position.x));
  const minY = Math.min(...document.nodes.map((node) => node.position.y));
  return { width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

/** Suggested download file name for a pack. */
export function buildFlowNodePackFileName(name: string): string {
  const safe = name.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'flow-node-pack'}.sloompack`;
}
