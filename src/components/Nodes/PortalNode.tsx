import { memo, useMemo } from 'react';
import { ArrowRightLeft, LogIn, LogOut, Waypoints } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { getCompatibleNodeActions } from '../../lib/nodeActionMenu';
import {
  getPortalConnectionSummary,
  resolvePortalExitSourceNode,
} from '../../lib/portalNodes';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps, FlowNodeType } from '../../types/flow';

function PortalNodeComponent({ id, data }: AppNodeProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const role = data.portalRole === 'exit' ? 'exit' : 'entry';
  const { setCenter, getViewport } = useReactFlow();

  const summary = useMemo(() => {
    const node = nodes.find((candidate) => candidate.id === id);
    return node ? getPortalConnectionSummary(node, nodes, edges) : undefined;
  }, [edges, id, nodes]);

  const outputActions = useMemo(() => {
    if (role !== 'exit') return [];
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const portalNode = nodesById.get(id);
    const sourceNode = portalNode ? resolvePortalExitSourceNode(portalNode, nodesById, edges) : undefined;
    return sourceNode ? getCompatibleNodeActions(sourceNode.type as FlowNodeType) : [];
  }, [edges, id, nodes, role]);

  const handleJump = () => {
    if (!summary?.pairedNodeId) return;
    const pairedNode = nodes.find((n) => n.id === summary.pairedNodeId);
    if (!pairedNode) return;

    const { zoom } = getViewport();
    const measured = pairedNode.measured as { width?: number; height?: number } | undefined;
    const width = measured?.width ?? pairedNode.width ?? 230;
    const height = measured?.height ?? pairedNode.height ?? 180;

    const x = pairedNode.position.x + width / 2;
    const y = pairedNode.position.y + height / 2;

    void setCenter(x, y, { duration: 450, zoom });
  };

  const incomingLabels = summary?.incomingLabels ?? [];
  const outgoingLabels = summary?.outgoingLabels ?? [];

  return (
    <BaseNode
      nodeId={id}
      nodeType="portal"
      icon={Waypoints}
      title={role === 'entry' ? 'Portal Entrance' : 'Portal Exit'}
      hasInput={role === 'entry'}
      hasOutput={role === 'exit'}
      outputActions={outputActions}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
      error={data.error}
      containerClassName="w-[230px]"
    >
      <div className="space-y-3 text-xs text-teal-50">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-teal-300/20 bg-teal-400/10 px-3 py-2">
          <div className="flex items-center gap-2 font-semibold">
            {role === 'entry' ? <LogIn size={14} /> : <LogOut size={14} />}
            {role === 'entry' ? 'Entrance' : 'Exit'}
          </div>
          {summary?.pairedNodeId ? (
            <button
              onClick={handleJump}
              title={role === 'entry' ? 'Jump to paired Exit' : 'Jump to paired Entrance'}
              className="flex items-center justify-center rounded-md border border-teal-300/30 bg-teal-500/20 p-1.5 text-teal-100 transition-all hover:bg-teal-500/40 hover:text-white cursor-pointer"
            >
              <ArrowRightLeft size={14} />
            </button>
          ) : (
            <ArrowRightLeft size={14} className="text-teal-100/35" />
          )}
        </div>
        <PortalConnectionList title="Into Portal" labels={incomingLabels} emptyLabel="No incoming routes" />
        <PortalConnectionList title="Out of Portal" labels={outgoingLabels} emptyLabel="No outgoing routes" />
        {summary?.pairedNodeId ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-teal-300/10 bg-[#10131b] pl-2 pr-1 py-1 text-[11px] text-teal-100/50">
            <span>Pair ID {String(data.portalPairId ?? '').slice(0, 12)}</span>
            <button
              onClick={handleJump}
              className="inline-flex items-center gap-1 rounded bg-teal-500/20 px-2 py-0.5 text-[10px] font-semibold text-teal-200 transition-colors hover:bg-teal-500/35 hover:text-white cursor-pointer"
              title={role === 'entry' ? 'Jump to paired Portal Exit' : 'Jump to paired Portal Entrance'}
            >
              <span>Jump</span>
              <ArrowRightLeft size={10} />
            </button>
          </div>
        ) : (
          <div className="rounded-md border border-amber-300/20 bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-100/75">
            Missing paired portal node.
          </div>
        )}
      </div>
    </BaseNode>
  );
}

export const PortalNode = memo(PortalNodeComponent);

function PortalConnectionList({
  emptyLabel,
  labels,
  title,
}: {
  emptyLabel: string;
  labels: string[];
  title: string;
}) {
  return (
    <div className="rounded-lg border border-teal-300/10 bg-[#10131b] p-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-100/45">{title}</div>
      {labels.length ? (
        <ul className="mt-1 space-y-1">
          {labels.slice(0, 4).map((label, index) => (
            <li className="truncate text-[11px] text-teal-50/80" key={`${label}-${index}`}>{label}</li>
          ))}
          {labels.length > 4 ? <li className="text-[11px] text-teal-100/45">+ {labels.length - 4} more</li> : null}
        </ul>
      ) : (
        <div className="mt-1 text-[11px] text-teal-100/35">{emptyLabel}</div>
      )}
    </div>
  );
}
