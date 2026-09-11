import { useEffect } from 'react';
import { Position, useUpdateNodeInternals } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore } from '../../store/flowStore';
import { TypedHandle as Handle } from './TypedHandle';

// When a node collapses, its per-handle ports (rendered in the expanded body) unmount, so React Flow
// loses the DOM anchor for the connected edges and stops DRAWING them — even though the connections
// still exist in the graph. This renders a minimal stub handle for every CONNECTED handle id (targets
// on the left edge, sources on the right), so every edge stays visibly connected to the collapsed node
// while the bulky per-handle labels stay hidden.
//
// Mount this ONLY in a node's collapsed content: there the real handles are absent, so the stub ids
// (which reuse the real ids so the edges re-anchor) never collide with a live handle of the same id.
const STUB_CLASS = '!h-2.5 !w-2.5 !min-w-0 !border !border-[#1e2027]';

export function CollapsedConnectionHandles({ nodeId }: { nodeId: string }) {
  const updateNodeInternals = useUpdateNodeInternals();

  // Return stable joined strings (not fresh arrays) so useShallow doesn't re-render on every store tick.
  const { targets, sources } = useFlowStore(
    useShallow((state) => {
      const targetSet = new Set<string>();
      const sourceSet = new Set<string>();
      for (const edge of state.edges) {
        if (edge.target === nodeId && edge.targetHandle) targetSet.add(edge.targetHandle);
        if (edge.source === nodeId && edge.sourceHandle) sourceSet.add(edge.sourceHandle);
      }
      return {
        targets: Array.from(targetSet).sort().join('|'),
        sources: Array.from(sourceSet).sort().join('|'),
      };
    }),
  );

  // Re-measure whenever the stub set changes (mount on collapse, or a connection added/removed while
  // collapsed) so React Flow routes the edges to the stub positions.
  useEffect(() => {
    updateNodeInternals(nodeId);
  }, [nodeId, targets, sources, updateNodeInternals]);

  const targetHandles = targets ? targets.split('|') : [];
  const sourceHandles = sources ? sources.split('|') : [];

  return (
    <>
      {targetHandles.map((handleId, index) => (
        <Handle
          key={`collapsed-target-${handleId}`}
          type="target"
          id={handleId}
          position={Position.Left}
          className={STUB_CLASS}
          style={{ top: `${38 + index * 13}px` }}
        />
      ))}
      {sourceHandles.map((handleId, index) => (
        <Handle
          key={`collapsed-source-${handleId}`}
          type="source"
          id={handleId}
          position={Position.Right}
          className={STUB_CLASS}
          style={{ top: `${38 + index * 13}px` }}
        />
      ))}
    </>
  );
}
