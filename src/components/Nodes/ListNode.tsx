import { memo, useMemo } from 'react';
import { Position } from '@xyflow/react';
import { AlertTriangle, Archive, Braces, Hash, Image as ImageIcon, Layers3, List, Music2, ToggleRight, Type, Video } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { getCompatibleNodeActions } from '../../lib/nodeActionMenu';
import {
  buildListItemTargetHandle,
  buildListNodeItems,
  getListNodeKind,
  getListNodeSlotCount,
  type FlowListItem,
} from '../../lib/listNodes';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps, ResultType } from '../../types/flow';
import { normalizeFlowVariableName } from '../../lib/flowVariables';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';

function ListNodeComponent({ id, data }: AppNodeProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const { items, listKind, slotCount } = useMemo(() => {
    const nextItems = buildListNodeItems(id, nodes, edges);
    return {
      items: nextItems,
      listKind: getListNodeKind(nextItems),
      slotCount: getListNodeSlotCount(nextItems),
    };
  }, [edges, id, nodes]);
  const itemsByIndex = new Map(items.map((item) => [item.index, item]));

  return (
    <BaseNode
      nodeId={id}
      nodeType="list"
      icon={List}
      title={listKind ? `${capitalizeKind(listKind)} List` : 'Typed List'}
      hasInput={false}
      outputActions={getCompatibleNodeActions('list')}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="grid grid-cols-2 gap-2">
        <SummaryCard label="Type" value={listKind ? capitalizeKind(listKind) : 'Unset'} />
        <SummaryCard label="Items" value={String(items.filter((item) => !item.invalidReason).length)} />
      </div>

      <label className="block rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-2">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Variable</span>
        <input
          className={withFlowNodeInteractionClasses('w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 outline-none focus:border-cyan-300')}
          onBlur={(event) => patchNodeData(id, { flowVariableName: normalizeFlowVariableName(event.target.value) })}
          onChange={(event) => patchNodeData(id, { flowVariableName: event.target.value })}
          placeholder="variable_name"
          value={data.flowVariableName ?? ''}
        />
      </label>

      <div className="space-y-2">
        {Array.from({ length: Math.max(1, slotCount) }, (_, index) => (
          <ListSlot
            item={itemsByIndex.get(index)}
            key={index}
            index={index}
            listKind={listKind}
          />
        ))}
      </div>
    </BaseNode>
  );
}

export const ListNode = memo(ListNodeComponent);

function ListSlot({
  index,
  item,
  listKind,
}: {
  index: number;
  item?: FlowListItem;
  listKind?: ResultType;
}) {
  const invalid = Boolean(item?.invalidReason);

  return (
    <div className={`relative rounded-lg border p-2 pl-6 ${
      invalid
        ? 'border-red-400/35 bg-red-500/10'
        : item
          ? 'border-emerald-400/25 bg-emerald-500/10'
          : 'border-dashed border-gray-700/70 bg-[#111217]/35'
    }`}>
      <Handle
        id={buildListItemTargetHandle(index)}
        type="target"
        position={Position.Left}
        className={`nodrag nopan !left-0 !top-1/2 !h-6 !w-6 !-translate-x-1/2 !-translate-y-1/2 !border-[3px] !border-[#1e2027] ${
          invalid ? '!bg-red-500' : item ? '!bg-emerald-500' : '!bg-blue-500'
        }`}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
            item ? 'border-gray-600 bg-[#0d0f15] text-gray-200' : 'border-gray-700 bg-[#0d0f15] text-gray-500'
          }`}>
            {item ? <KindIcon kind={item.kind} /> : <List size={13} />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-gray-100">
              {item?.label ?? `Slot ${index + 1}`}
            </div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">
              {item?.kind ?? (listKind ? `${listKind} only` : 'Empty')}
            </div>
          </div>
        </div>
        <div className="rounded-full border border-gray-700/60 bg-[#0d0f15] px-2 py-1 text-[10px] text-gray-400">
          {index + 1}
        </div>
      </div>
      {item?.invalidReason ? (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-red-400/25 bg-red-500/10 px-2 py-1.5 text-[11px] leading-4 text-red-100">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{item.invalidReason}</span>
        </div>
      ) : null}
      {!item ? (
        <div className="mt-2 text-[11px] leading-4 text-gray-500">
          {listKind ? `Waiting for ${listKind} item ${index + 1}` : 'First item sets the list type'}
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-700/60 bg-[#111217]/35 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-gray-100">{value}</div>
    </div>
  );
}

function KindIcon({ kind }: { kind: ResultType }) {
  switch (kind) {
    case 'image':
      return <ImageIcon size={14} />;
    case 'video':
      return <Video size={14} />;
    case 'audio':
      return <Music2 size={14} />;
    case 'text':
      return <Type size={14} />;
    case 'boolean':
      return <ToggleRight size={14} />;
    case 'json':
      return <Braces size={14} />;
    case 'package':
      return <Archive size={14} />;
    case 'number':
      return <Hash size={14} />;
    case 'list':
      return <List size={14} />;
    case 'envelope':
      return <Layers3 size={14} />;
  }
}

function capitalizeKind(kind: ResultType): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
