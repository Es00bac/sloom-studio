import { resolveNodeBookmarkRename } from '../../../lib/nodeBookmarks';
import type { AppNode } from '../../../types/flow';

export type AttachFlowRuntimeData = (node: AppNode) => AppNode;

export function renameNodeBookmarkState(
  nodes: AppNode[],
  bookmarkSidebarOpen: boolean,
  id: string,
  rawTitle: string | null,
  attachRuntimeData: AttachFlowRuntimeData,
): { nodes: AppNode[]; bookmarkSidebarOpen: boolean } | undefined {
  const result = resolveNodeBookmarkRename(rawTitle);

  if (!result) {
    return undefined;
  }

  return {
    nodes: nodes.map((node) =>
      node.id === id
        ? attachRuntimeData({ ...node, data: { ...node.data, ...result.patch } })
        : node,
    ),
    bookmarkSidebarOpen: result.shouldOpenBookmarkSidebar ? true : bookmarkSidebarOpen,
  };
}
