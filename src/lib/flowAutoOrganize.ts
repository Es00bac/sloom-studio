import type { Edge } from '@xyflow/react';

import type { AppNode, FlowNodeType } from '../types/flow';
import {
  isPortalSyntheticEdge,
  normalizePortalEdges,
} from './portalNodes';
import { getNodeTypeLabel } from './nodeBookmarks';

export interface FlowAutoOrganizeInput {
  nodes: AppNode[];
  edges: Edge[];
}

export interface FlowAutoOrganizeOptions {
  columnGap?: number;
  rowGap?: number;
  portalDistanceThreshold?: number;
  createId?: (prefix: string) => string;
}

export interface FlowAutoOrganizeSummary {
  movedNodeCount: number;
  portalPairCount: number;
  visibleEdgeCount: number;
}

export interface FlowAutoOrganizeResult {
  nodes: AppNode[];
  edges: Edge[];
  summary: FlowAutoOrganizeSummary;
}

export interface FlowAiOrganizationPlan {
  nodes: Array<{
    id: string;
    x: number;
    y: number;
  }>;
  portals?: Array<{
    source: string;
    target: string;
    label?: string;
  }>;
  rationale?: string;
}

export interface FlowAiOrganizationResult extends FlowAutoOrganizeResult {
  summary: FlowAutoOrganizeSummary & {
    positionedNodeCount: number;
    ignoredPortalCount: number;
  };
}

export const FLOW_ORGANIZATION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['id', 'x', 'y'],
      },
    },
    portals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['source', 'target'],
      },
    },
    rationale: { type: 'string' },
  },
  required: ['nodes'],
};

const DEFAULT_COLUMN_GAP = 360;
const DEFAULT_ROW_GAP = 220;
const DEFAULT_PORTAL_DISTANCE_THRESHOLD = 920;
const MAX_AI_COORDINATE = 24000;

export function autoOrganizeFlowSnapshot(
  input: FlowAutoOrganizeInput,
  options: FlowAutoOrganizeOptions = {},
): FlowAutoOrganizeResult {
  const columnGap = options.columnGap ?? DEFAULT_COLUMN_GAP;
  const rowGap = options.rowGap ?? DEFAULT_ROW_GAP;
  const portalDistanceThreshold = options.portalDistanceThreshold ?? DEFAULT_PORTAL_DISTANCE_THRESHOLD;
  const createId = options.createId ?? defaultCreateId;
  const visibleEdges = input.edges.filter((edge) => !isPortalSyntheticEdge(edge));
  const nodeDepths = computeNodeDepths(input.nodes, visibleEdges);
  const minX = Math.min(0, ...input.nodes.map((node) => node.position.x));
  const minY = Math.min(0, ...input.nodes.map((node) => node.position.y));
  const positionedNodes = positionNodesInColumns(input.nodes, nodeDepths, {
    columnGap,
    rowGap,
    originX: minX,
    originY: minY,
  });
  const positionedById = new Map(positionedNodes.map((node) => [node.id, node]));
  const nextNodes = [...positionedNodes];
  const nextVisibleEdges: Edge[] = [];
  let portalPairCount = 0;

  for (const edge of visibleEdges) {
    const source = positionedById.get(edge.source);
    const target = positionedById.get(edge.target);

    if (!source || !target || source.type === 'portal' || target.type === 'portal') {
      nextVisibleEdges.push(edge);
      continue;
    }

    const distance = Math.hypot(target.position.x - source.position.x, target.position.y - source.position.y);
    if (distance <= portalDistanceThreshold) {
      nextVisibleEdges.push(edge);
      continue;
    }

    const pairId = createId('portal-pair');
    const entryId = createId('portal-entry');
    const exitId = createId('portal-exit');
    const portalLabel = `Auto portal: ${nodeLabel(source)} to ${nodeLabel(target)}`;
    const entry = createPortalNode(entryId, 'entry', pairId, portalLabel, {
      x: source.position.x + Math.min(220, columnGap * 0.62),
      y: source.position.y + 28,
    });
    const exit = createPortalNode(exitId, 'exit', pairId, portalLabel, {
      x: target.position.x - Math.min(220, columnGap * 0.62),
      y: target.position.y + 28,
    });

    nextNodes.push(entry, exit);
    nextVisibleEdges.push({
      ...edge,
      id: `${edge.id}-to-${entryId}`,
      target: entryId,
      targetHandle: null,
    });
    nextVisibleEdges.push({
      id: `${exitId}-to-${edge.target}`,
      source: exitId,
      sourceHandle: null,
      target: edge.target,
      targetHandle: edge.targetHandle,
    });
    portalPairCount += 1;
  }

  return {
    nodes: nextNodes,
    edges: normalizePortalEdges(nextNodes, nextVisibleEdges),
    summary: {
      movedNodeCount: positionedNodes.length,
      portalPairCount,
      visibleEdgeCount: nextVisibleEdges.length,
    },
  };
}

export function buildFlowOrganizationPrompt(input: FlowAutoOrganizeInput): string {
  const visibleEdges = input.edges.filter((edge) => !isPortalSyntheticEdge(edge));
  const bounds = getNodeBounds(input.nodes);
  const nodes = input.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    label: nodeLabel(node),
    x: Math.round(node.position.x),
    y: Math.round(node.position.y),
    prompt: compactText(node.data.prompt),
    sourceAssetName: compactText(node.data.sourceAssetName),
    portalRole: node.data.portalRole,
  }));
  const edges = visibleEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
  }));

  return [
    'You are organizing a Sloom Studio node workspace for a visual AI media workflow.',
    'Return only JSON matching the requested schema.',
    'Move nodes into a clean, readable left-to-right workflow. Keep related branches near each other, reduce crossing edges, and leave at least 220px vertical spacing and 320px horizontal spacing where practical.',
    'Do not return the existing coordinates as the plan. If the graph is messy, sprawling, or overlapping, move nodes into a visibly cleaner compact layout.',
    'Do not invent semantic edges. If an existing edge spans a long distance or would make the workspace hard to read, recommend a portal for that exact source and target only.',
    'Keep coordinates finite and within the same broad workspace area. Preserve every node id; do not rename nodes.',
    `Current graph bounds: ${JSON.stringify(bounds)}`,
    '',
    `Nodes: ${JSON.stringify(nodes)}`,
    `Edges: ${JSON.stringify(edges)}`,
  ].join('\n');
}

export function parseFlowOrganizationPlanText(text: string): FlowAiOrganizationPlan {
  const jsonText = extractJsonObjectText(text);
  const parsed = JSON.parse(jsonText) as unknown;

  if (!isRecord(parsed) || !Array.isArray(parsed.nodes)) {
    throw new Error('Vertex Gemini did not return a usable flow layout plan.');
  }

  const nodes = parsed.nodes
    .filter((candidate): candidate is Record<string, unknown> => isRecord(candidate))
    .map((candidate) => ({
      id: typeof candidate.id === 'string' ? candidate.id : '',
      x: Number(candidate.x),
      y: Number(candidate.y),
    }))
    .filter((candidate) => candidate.id && Number.isFinite(candidate.x) && Number.isFinite(candidate.y));
  const portals = Array.isArray(parsed.portals)
    ? parsed.portals
      .filter((candidate): candidate is Record<string, unknown> => isRecord(candidate))
      .map((candidate) => ({
        source: typeof candidate.source === 'string' ? candidate.source : '',
        target: typeof candidate.target === 'string' ? candidate.target : '',
        label: typeof candidate.label === 'string' ? candidate.label : undefined,
      }))
      .filter((candidate) => candidate.source && candidate.target)
    : undefined;

  if (nodes.length === 0) {
    throw new Error('Vertex Gemini returned a flow layout plan without node positions.');
  }

  const plan: FlowAiOrganizationPlan = {
    nodes,
    portals,
  };

  if (typeof parsed.rationale === 'string') {
    plan.rationale = parsed.rationale;
  }

  return plan;
}

export function applyFlowAiOrganizationPlan(
  input: FlowAutoOrganizeInput,
  plan: FlowAiOrganizationPlan,
  options: FlowAutoOrganizeOptions = {},
): FlowAiOrganizationResult {
  const createId = options.createId ?? defaultCreateId;
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  const originalPositions = new Map(input.nodes.map((node) => [node.id, node.position]));
  const requestedPositions = new Map<string, { x: number; y: number }>();
  let movedNodeCount = 0;

  for (const position of plan.nodes) {
    if (!nodeIds.has(position.id) || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      continue;
    }

    requestedPositions.set(position.id, {
      x: clampAiCoordinate(position.x),
      y: clampAiCoordinate(position.y),
    });
  }

  const positionedNodes = input.nodes.map((node) => {
    const position = requestedPositions.get(node.id);

    if (position && getPositionDelta(originalPositions.get(node.id), position) > 1) {
      movedNodeCount += 1;
    }

    return position
      ? {
        ...node,
        position,
      }
      : node;
  });
  const positionedById = new Map(positionedNodes.map((node) => [node.id, node]));
  const nextNodes = [...positionedNodes];
  let nextVisibleEdges = input.edges.filter((edge) => !isPortalSyntheticEdge(edge));
  let portalPairCount = 0;
  let ignoredPortalCount = 0;

  for (const portalRequest of plan.portals ?? []) {
    const source = positionedById.get(portalRequest.source);
    const target = positionedById.get(portalRequest.target);
    const directEdge = nextVisibleEdges.find((edge) => edge.source === portalRequest.source && edge.target === portalRequest.target);

    if (!source || !target || !directEdge || source.type === 'portal' || target.type === 'portal') {
      ignoredPortalCount += 1;
      continue;
    }

    const pairId = createId('portal-pair');
    const entryId = createId('portal-entry');
    const exitId = createId('portal-exit');
    const portalLabel = compactText(portalRequest.label) || `Gemini portal: ${nodeLabel(source)} to ${nodeLabel(target)}`;
    const entry = createPortalNode(entryId, 'entry', pairId, portalLabel, {
      x: source.position.x + 220,
      y: source.position.y + 28,
    });
    const exit = createPortalNode(exitId, 'exit', pairId, portalLabel, {
      x: target.position.x - 220,
      y: target.position.y + 28,
    });

    nextNodes.push(entry, exit);
    nextVisibleEdges = nextVisibleEdges.filter((edge) => edge.id !== directEdge.id);
    nextVisibleEdges.push({
      ...directEdge,
      id: `${directEdge.id}-to-${entryId}`,
      target: entryId,
      targetHandle: null,
    });
    nextVisibleEdges.push({
      id: `${exitId}-to-${directEdge.target}`,
      source: exitId,
      sourceHandle: null,
      target: directEdge.target,
      targetHandle: directEdge.targetHandle,
    });
    portalPairCount += 1;
  }

  return {
    nodes: nextNodes,
    edges: normalizePortalEdges(nextNodes, nextVisibleEdges),
    summary: {
      movedNodeCount,
      positionedNodeCount: requestedPositions.size,
      portalPairCount,
      ignoredPortalCount,
      visibleEdgeCount: nextVisibleEdges.length,
    },
  };
}

export function isFlowOrganizationResultNoop(result: FlowAutoOrganizeResult): boolean {
  return result.summary.movedNodeCount === 0 && result.summary.portalPairCount === 0;
}

function computeNodeDepths(nodes: AppNode[], edges: Edge[]): Map<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, Edge[]>();
  const depth = new Map<string, number>();

  for (const node of nodes) {
    incomingCount.set(node.id, 0);
    outgoing.set(node.id, []);
    depth.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  const queue = nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .sort(compareNodesByPosition)
    .map((node) => node.id);
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    for (const edge of outgoing.get(nodeId) ?? []) {
      depth.set(edge.target, Math.max(depth.get(edge.target) ?? 0, (depth.get(nodeId) ?? 0) + 1));
      incomingCount.set(edge.target, Math.max(0, (incomingCount.get(edge.target) ?? 0) - 1));
      if ((incomingCount.get(edge.target) ?? 0) === 0) {
        queue.push(edge.target);
      }
    }
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      depth.set(node.id, Math.max(0, Math.round(node.position.x / DEFAULT_COLUMN_GAP)));
    }
  }

  return depth;
}

function positionNodesInColumns(
  nodes: AppNode[],
  depths: Map<string, number>,
  layout: { columnGap: number; rowGap: number; originX: number; originY: number },
): AppNode[] {
  const columns = new Map<number, AppNode[]>();

  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    const column = columns.get(depth);
    if (column) {
      column.push(node);
    } else {
      columns.set(depth, [node]);
    }
  }

  return [...columns.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([depth, column]) => column
      .sort(compareNodesByPosition)
      .map((node, rowIndex) => ({
        ...node,
        position: {
          x: roundLayout(layout.originX + depth * layout.columnGap),
          y: roundLayout(layout.originY + rowIndex * layout.rowGap),
        },
      })));
}

function createPortalNode(
  id: string,
  role: 'entry' | 'exit',
  pairId: string,
  label: string,
  position: { x: number; y: number },
): AppNode {
  return {
    id,
    type: 'portal',
    position: {
      x: roundLayout(position.x),
      y: roundLayout(position.y),
    },
    data: {
      portalRole: role,
      portalPairId: pairId,
      portalLabel: label,
    },
  };
}

function compareNodesByPosition(left: AppNode, right: AppNode): number {
  const yDelta = left.position.y - right.position.y;
  if (yDelta !== 0) return yDelta;
  const xDelta = left.position.x - right.position.x;
  if (xDelta !== 0) return xDelta;
  return left.id.localeCompare(right.id);
}

function nodeLabel(node: AppNode): string {
  const title = typeof node.data.customTitle === 'string' ? node.data.customTitle.trim() : '';
  return title || getNodeTypeLabel(node.type as FlowNodeType);
}

function roundLayout(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampAiCoordinate(value: number): number {
  return roundLayout(Math.max(-MAX_AI_COORDINATE, Math.min(MAX_AI_COORDINATE, value)));
}

function getNodeBounds(nodes: readonly AppNode[]): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  const xs = nodes.map((node) => node.position.x);
  const ys = nodes.map((node) => node.position.y);
  const minX = Math.min(0, ...xs);
  const minY = Math.min(0, ...ys);
  const maxX = Math.max(0, ...xs);
  const maxY = Math.max(0, ...ys);

  return {
    minX: roundLayout(minX),
    minY: roundLayout(minY),
    maxX: roundLayout(maxX),
    maxY: roundLayout(maxY),
    width: roundLayout(maxX - minX),
    height: roundLayout(maxY - minY),
  };
}

function getPositionDelta(
  left: { x: number; y: number } | undefined,
  right: { x: number; y: number },
): number {
  if (!left) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.hypot(right.x - left.x, right.y - left.y);
}

function compactText(value: unknown, limit = 180): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted || undefined;
}

function extractJsonObjectText(text: string): string {
  const trimmed = text.trim();
  const fencedMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Vertex Gemini returned layout text instead of JSON.');
  }

  return candidate.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultCreateId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`}`;
}
