import type { Connection, Edge } from '@xyflow/react';
import type { AppNode, ImageTargetHandle } from '../types/flow';
import {
  IMAGE_REFERENCE_HANDLES,
  isImageConditioningHandle,
} from './imageModelSupport';
import { resolveEffectiveSourceNode } from './virtualNodes';

const IMAGE_INPUT_HANDLES: ImageTargetHandle[] = [
  'image-edit-source',
  ...IMAGE_REFERENCE_HANDLES,
];

export function normalizeImageEdges(nodes: AppNode[], edges: Edge[]): Edge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const preserved: Edge[] = [];
  const legacyByTarget = new Map<string, Edge[]>();

  for (const edge of edges) {
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
      : undefined;
    const targetNode = nodesById.get(edge.target);
    const targetHandle = edge.targetHandle ?? undefined;

    if (
      isImageInputSource(sourceNode) &&
      targetNode?.type === 'imageGen' &&
      !isImageConditioningHandle(targetHandle)
    ) {
      const bucket = legacyByTarget.get(edge.target) ?? [];
      bucket.push(edge);
      legacyByTarget.set(edge.target, bucket);
      continue;
    }

    preserved.push(edge);
  }

  for (const [targetId, legacyEdges] of legacyByTarget.entries()) {
    const occupiedHandles = new Set(
      preserved
        .filter((edge) => edge.target === targetId && isImageConditioningHandle(edge.targetHandle ?? undefined))
        .map((edge) => edge.targetHandle as ImageTargetHandle),
    );

    for (const edge of legacyEdges) {
      const nextHandle = IMAGE_INPUT_HANDLES.find((handle) => !occupiedHandles.has(handle));

      if (!nextHandle) {
        preserved.push(edge);
        continue;
      }

      preserved.push({
        ...edge,
        targetHandle: nextHandle,
      });

      occupiedHandles.add(nextHandle);
    }
  }

  return dedupeExclusiveImageEdges(nodesById, preserved);
}

export function normalizeImageConnectionTargetHandle(
  connection: Connection,
  nodes: AppNode[],
  edges: Edge[],
): Connection {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const rawSourceNode = nodesById.get(connection.source);
  const sourceNode = rawSourceNode
    ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
    : undefined;
  const targetNode = nodes.find((node) => node.id === connection.target);
  const targetHandle = connection.targetHandle ?? undefined;

  if (
    !isImageInputSource(sourceNode) ||
    targetNode?.type !== 'imageGen' ||
    isImageConditioningHandle(targetHandle)
  ) {
    return connection;
  }

  const targetEdges = edges.filter((edge) => edge.target === connection.target);
  const nextHandle = IMAGE_INPUT_HANDLES.find(
    (handle) => !targetEdges.some((edge) => edge.targetHandle === handle),
  );

  if (!nextHandle) {
    return connection;
  }

  return {
    ...connection,
    targetHandle: nextHandle,
  };
}

function dedupeExclusiveImageEdges(
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): Edge[] {
  const seenKeys = new Set<string>();
  const dedupedReversed: Edge[] = [];

  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
      : undefined;
    const targetNode = nodesById.get(edge.target);
    const targetHandle = edge.targetHandle ?? undefined;

    if (
      !isImageInputSource(sourceNode) ||
      targetNode?.type !== 'imageGen' ||
      !isImageConditioningHandle(targetHandle)
    ) {
      dedupedReversed.push(edge);
      continue;
    }

    const key = `${edge.target}:${targetHandle}`;

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    dedupedReversed.push(edge);
  }

  return dedupedReversed.reverse();
}

function isImageInputSource(node: AppNode | undefined): node is AppNode {
  return node?.type === 'imageGen' || node?.type === 'cropImageNode';
}
