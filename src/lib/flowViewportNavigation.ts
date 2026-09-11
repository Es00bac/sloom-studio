import type { SetCenterOptions } from '@xyflow/react';
import type { AppNode } from '../types/flow';

export interface FlowCenterViewportRequest {
  x: number;
  y: number;
  options: SetCenterOptions;
}

export function buildNodeCenterViewportRequest(
  node: AppNode,
  zoom: number,
  duration = 450,
): FlowCenterViewportRequest {
  const measured = node.measured as { width?: number; height?: number } | undefined;
  const width = measured?.width ?? node.width ?? 260;
  const height = measured?.height ?? node.height ?? 180;

  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
    options: {
      duration,
      zoom,
    },
  };
}

export function shouldJumpToBookmarkFromConnectorDrag({
  active,
  bookmarkNodeId,
  lastBookmarkNodeId,
}: {
  active: boolean;
  bookmarkNodeId?: string;
  lastBookmarkNodeId?: string;
}): boolean {
  return Boolean(active && bookmarkNodeId && bookmarkNodeId !== lastBookmarkNodeId);
}
