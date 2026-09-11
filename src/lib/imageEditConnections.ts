import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { resolveFlowImageSource } from './flowImageSources';
import { resolveEffectiveSourceNode } from './virtualNodes';

export function hasConnectedImageEditSource(
  nodes: AppNode[],
  edges: Edge[],
  targetNodeId: string,
): boolean {
  return hasConnectedImageInput(nodes, edges, targetNodeId, ['image-edit-source']);
}

export function hasConnectedImageReferenceSource(
  nodes: AppNode[],
  edges: Edge[],
  targetNodeId: string,
  targetHandles: Array<string | undefined>,
): boolean {
  return hasConnectedImageInput(nodes, edges, targetNodeId, targetHandles);
}

export function hasConnectedImageMaskSource(
  nodes: AppNode[],
  edges: Edge[],
  targetNodeId: string,
): boolean {
  return hasConnectedImageInput(nodes, edges, targetNodeId, ['image-mask']);
}

export function resolveConnectedImageEditAsset(
  nodes: AppNode[],
  edges: Edge[],
  targetNodeId: string,
): string | undefined {
  return resolveConnectedImageInputAsset(nodes, edges, targetNodeId, ['image-edit-source']);
}

export function resolveConnectedImageReferenceAsset(
  nodes: AppNode[],
  edges: Edge[],
  targetNodeId: string,
  targetHandles: Array<string | undefined>,
): string | undefined {
  return resolveConnectedImageInputAsset(nodes, edges, targetNodeId, targetHandles);
}

export function resolveConnectedImageMaskAsset(
  nodes: AppNode[],
  edges: Edge[],
  targetNodeId: string,
): string | undefined {
  return resolveConnectedImageInputAsset(nodes, edges, targetNodeId, ['image-mask']);
}

export function hasConnectedImageInput(
  nodes: AppNode[],
  edges: Edge[],
  targetNodeId: string,
  targetHandles: Array<string | undefined>,
): boolean {
  return Boolean(findConnectedImageInputSource(nodes, edges, targetNodeId, targetHandles));
}

export function resolveConnectedImageInputAsset(
  nodes: AppNode[],
  edges: Edge[],
  targetNodeId: string,
  targetHandles: Array<string | undefined>,
): string | undefined {
  const source = findConnectedImageInputSource(nodes, edges, targetNodeId, targetHandles);

  if (!source) {
    return undefined;
  }

  return source.assetUrl;
}

function findConnectedImageInputSource(
  nodes: AppNode[],
  edges: Edge[],
  targetNodeId: string,
  targetHandles: Array<string | undefined>,
): { node: AppNode; assetUrl?: string } | undefined {
  const sourceEdges = edges.filter(
    (edge) => edge.target === targetNodeId && targetHandles.includes(edge.targetHandle ?? undefined),
  );
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const sourceEdge of sourceEdges) {
    const rawSourceNode = nodesById.get(sourceEdge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
      : undefined;

    const resolved = resolveFlowImageSource(sourceNode, nodes, edges, sourceEdge.sourceHandle);
    if (sourceNode && resolved.recognized) {
      return { node: sourceNode, assetUrl: resolved.assetUrl };
    }
  }

  return undefined;
}
