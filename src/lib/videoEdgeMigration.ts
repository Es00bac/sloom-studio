import type { Connection, Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import {
  isVideoImageConditioningHandle,
} from './videoModelSupport';
import { resolveEffectiveSourceNode } from './virtualNodes';

const VIDEO_IMAGE_HANDLES = [
  'video-start-frame',
  'video-end-frame',
  'video-reference-1',
  'video-reference-2',
  'video-reference-3',
] as const;

export function normalizeVideoImageEdges(nodes: AppNode[], edges: Edge[]): Edge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const preserved: Edge[] = [];
  const legacyByTarget = new Map<string, Edge[]>();
  const videoIds = new Set<string>();

  for (const edge of edges) {
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
      : undefined;
    const targetNode = nodesById.get(edge.target);
    const targetHandle = edge.targetHandle ?? undefined;

    if (targetNode?.type === 'videoGen') {
      videoIds.add(targetNode.id);
    }

    if (
      isVideoFrameImageSource(sourceNode) &&
      targetNode?.type === 'videoGen' &&
      !isVideoImageConditioningHandle(targetHandle)
    ) {
      const bucket = legacyByTarget.get(edge.target) ?? [];
      bucket.push(edge);
      legacyByTarget.set(edge.target, bucket);
      continue;
    }

    preserved.push(edge);
  }

  for (const [targetId, legacyEdges] of legacyByTarget.entries()) {
    const targetEdges = preserved.filter((edge) => edge.target === targetId);
    const hasStartFrame = targetEdges.some((edge) => edge.targetHandle === 'video-start-frame');
    const hasEndFrame = targetEdges.some((edge) => edge.targetHandle === 'video-end-frame');
    const availableHandles = VIDEO_IMAGE_HANDLES.filter((handle) =>
      !targetEdges.some((edge) => edge.targetHandle === handle),
    );

    if (legacyEdges.length === 1 && !hasStartFrame && !hasEndFrame) {
      const [legacyEdge] = legacyEdges;
      preserved.push(
        {
          ...legacyEdge,
          targetHandle: 'video-start-frame',
        },
        {
          ...legacyEdge,
          id: `${legacyEdge.id}-end-frame`,
          targetHandle: 'video-end-frame',
        },
      );
      continue;
    }

    legacyEdges.forEach((edge, index) => {
      const nextHandle = availableHandles[index];

      preserved.push({
        ...edge,
        targetHandle: nextHandle ?? edge.targetHandle,
      });
    });
  }

  const deduped = dedupeExclusiveVideoFrameEdges(nodesById, preserved);

  for (const videoId of videoIds) {
    const videoEdges = deduped.filter((edge) => edge.target === videoId);
    const startFrameEdges = videoEdges.filter((edge) => edge.targetHandle === 'video-start-frame');
    const endFrameEdges = videoEdges.filter((edge) => edge.targetHandle === 'video-end-frame');

    if (startFrameEdges.length === 0 && endFrameEdges.length === 1) {
      const [endFrameEdge] = endFrameEdges;
      const rawSourceNode = nodesById.get(endFrameEdge.source);
      const sourceNode = rawSourceNode
        ? resolveEffectiveSourceNode(rawSourceNode, nodesById, deduped)
        : undefined;

      if (isVideoFrameImageSource(sourceNode)) {
        deduped.push({
          ...endFrameEdge,
          id: `${endFrameEdge.id}-start-frame`,
          targetHandle: 'video-start-frame',
        });
      }
    }
  }

  return deduped;
}

export function normalizeVideoImageConnectionTargetHandle(
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
    !isVideoFrameImageSource(sourceNode) ||
    targetNode?.type !== 'videoGen' ||
    isVideoImageConditioningHandle(targetHandle)
  ) {
    return connection;
  }

  const targetEdges = edges.filter((edge) => edge.target === connection.target);
  const nextHandle = VIDEO_IMAGE_HANDLES.find(
    (handle) => !targetEdges.some((edge) => edge.targetHandle === handle),
  );

  if (nextHandle) {
    return {
      ...connection,
      targetHandle: nextHandle,
    };
  }

  return connection;
}

export function replaceExclusiveVideoFrameEdges(
  connection: Connection,
  nodes: AppNode[],
  edges: Edge[],
): Edge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const rawSourceNode = nodesById.get(connection.source);
  const sourceNode = rawSourceNode
    ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
    : undefined;
  const targetNode = nodes.find((node) => node.id === connection.target);
  const targetHandle = connection.targetHandle ?? undefined;

  if (
    !isVideoFrameImageSource(sourceNode) ||
    targetNode?.type !== 'videoGen' ||
    !isVideoImageConditioningHandle(targetHandle)
  ) {
    return edges;
  }

  return edges.filter(
    (edge) => !(edge.target === connection.target && edge.targetHandle === connection.targetHandle),
  );
}

function isVideoFrameImageSource(node: AppNode | undefined): node is AppNode {
  return node?.type === 'imageGen' || node?.type === 'cropImageNode';
}

function dedupeExclusiveVideoFrameEdges(
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): Edge[] {
  const seenFrameKeys = new Set<string>();
  const dedupedReversed: Edge[] = [];

  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    const targetNode = nodesById.get(edge.target);
    const targetHandle = edge.targetHandle ?? undefined;

    if (targetNode?.type !== 'videoGen' || !isVideoImageConditioningHandle(targetHandle)) {
      dedupedReversed.push(edge);
      continue;
    }

    const key = `${edge.target}:${targetHandle}`;

    if (seenFrameKeys.has(key)) {
      continue;
    }

    seenFrameKeys.add(key);
    dedupedReversed.push(edge);
  }

  return dedupedReversed.reverse();
}
