import { Boxes, Minimize2 } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import type { AppNodeProps, GroupNodeConfig } from '../../types/flow';

const fallbackGroup: GroupNodeConfig = {
  title: 'Group',
  childNodeIds: [],
  childEdgeIds: [],
  bounds: { x: 0, y: 0, width: 0, height: 0 },
  collapsed: false,
};

export function GroupNode({ id, data }: AppNodeProps) {
  const group = data.groupNode ?? fallbackGroup;

  const updateGroup = (patch: Partial<GroupNodeConfig>) => {
    data.onChange?.('groupNode', {
      ...group,
      ...patch,
    });
  };

  return (
    <BaseNode
      containerClassName="w-[300px]"
      hasInput={false}
      hasOutput={false}
      icon={Boxes}
      nodeId={id}
      nodeType="groupNode"
      title={group.title}
    >
      <div className={withFlowNodeInteractionClasses('space-y-3')}>
        <input
          className="w-full rounded-md border border-slate-300/15 bg-black/25 px-2 py-1.5 text-sm font-semibold text-slate-50 outline-none focus:border-slate-200/60"
          onChange={(event) => updateGroup({ title: event.target.value })}
          value={group.title}
        />
        <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-slate-100/65">
          <div className="rounded-md border border-white/10 bg-white/[0.04] p-2">
            <div className="text-base font-semibold text-slate-50">{group.childNodeIds.length}</div>
            Nodes
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.04] p-2">
            <div className="text-base font-semibold text-slate-50">{group.childEdgeIds.length}</div>
            Edges
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.04] p-2">
            <div className="text-base font-semibold text-slate-50">{Math.round(group.bounds.width)}</div>
            Width
          </div>
        </div>
        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300/20 bg-slate-300/10 px-3 py-2 text-xs font-semibold text-slate-100 transition-colors hover:border-slate-200/60"
          onClick={() => updateGroup({ collapsed: !group.collapsed })}
          type="button"
        >
          <Minimize2 size={14} />
          {group.collapsed ? 'Marked collapsed' : 'Mark collapsed'}
        </button>
      </div>
    </BaseNode>
  );
}
