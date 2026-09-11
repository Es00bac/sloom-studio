import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import {
  collectEnvelopeItemsForEnvelopeNode,
  resolveExpandedListItemForNode,
  resolvePackageNodeData,
} from './listNodes';
import { resultValueAsMediaUrl } from './flowResultValues';

export interface FlowImageSourceResolution {
  recognized: boolean;
  assetUrl?: string;
}

/**
 * Resolves every concrete Flow value that the image execution collectors treat as an image.
 * `recognized` deliberately remains true before an executable media node has produced pixels so
 * the node UI can distinguish a wired input from a missing connection.
 */
export function resolveFlowImageSource(
  node: AppNode | undefined,
  nodes: AppNode[],
  edges: Edge[],
  sourceHandle?: string | null,
): FlowImageSourceResolution {
  if (!node) return { recognized: false };

  if (node.type === 'imageGen' || node.type === 'cropImageNode') {
    return {
      recognized: true,
      assetUrl: (node.data.mediaMode ?? 'generate') === 'import'
        ? resultValueAsMediaUrl(node.data.sourceAssetUrl) ?? resultValueAsMediaUrl(node.data.result)
        : resultValueAsMediaUrl(node.data.result),
    };
  }

  if (node.type === 'slimgNode') {
    return { recognized: true, assetUrl: typeof node.data.result === 'string' ? node.data.result : undefined };
  }

  if (node.type === 'advancedImageEditor') {
    const value = sourceHandle === 'maskOutput' ? node.data.maskOutput : node.data.result;
    return { recognized: true, assetUrl: typeof value === 'string' ? value : undefined };
  }

  if (node.type === 'functionNode') {
    return {
      recognized: node.data.resultType === 'image',
      assetUrl: node.data.resultType === 'image' && typeof node.data.result === 'string' ? node.data.result : undefined,
    };
  }

  if (node.type === 'packageNode') {
    return { recognized: true, assetUrl: resolvePackageNodeData(node.id, nodes, edges).image };
  }

  if (node.type === 'doodleNode') {
    return {
      recognized: true,
      assetUrl: typeof node.data.doodleSketch === 'string' && node.data.doodleSketch ? node.data.doodleSketch : undefined,
    };
  }

  if (node.type === 'expander') {
    const item = resolveExpandedListItemForNode(node, nodes, edges);
    return {
      recognized: item?.kind === 'image' || item?.kind === 'package',
      assetUrl: item?.kind === 'image' || item?.kind === 'package' ? item.value : undefined,
    };
  }

  if (node.type === 'envelope') {
    const item = collectEnvelopeItemsForEnvelopeNode(node.id, nodes, edges)
      .find((candidate) => candidate.kind === 'image' || candidate.kind === 'package');
    return { recognized: true, assetUrl: item?.value };
  }

  return { recognized: false };
}
