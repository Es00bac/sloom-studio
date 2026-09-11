import { useMemo, memo } from 'react';
import { Position } from '@xyflow/react';
import { Archive, ChevronLeft, ChevronRight, ChevronsRight, Image as ImageIcon, Music2, Type, Video, Cpu } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { getCompatibleNodeActions } from '../../lib/nodeActionMenu';
import {
  buildExpanderSourceItems,
  resolveExpandedListItemForNode,
  evaluateNodeTextForMonitor,
  type FlowListItem,
} from '../../lib/listNodes';
import { getExpanderPreviewKind } from '../../lib/expanderPreview';
import { useFlowStore } from '../../store/flowStore';
import { resolveEffectiveSourceNode } from '../../lib/virtualNodes';
import type { AppNodeProps, ResultType } from '../../types/flow';


function ExpanderNodeComponent({ id, data }: AppNodeProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const currentNode = useMemo(() => nodes.find((node) => node.id === id), [id, nodes]);
  const items = useMemo(() => buildExpanderSourceItems(id, nodes, edges), [edges, id, nodes]);
  const selectedItem = useMemo(
    () => resolveExpandedListItemForNode(currentNode, nodes, edges),
    [currentNode, edges, nodes],
  );
  const selectedPreviewKind = getExpanderPreviewKind(selectedItem);
  const selectedIndex = Number.isInteger(data.expandedItemIndex) ? Number(data.expandedItemIndex) : 0;
  const selectedOrdinal = Math.max(0, items.findIndex((item: FlowListItem) => item.id === selectedItem?.id));

  const dynamicIndex = useMemo(() => {
    const indexEdge = edges.find((edge) => edge.target === id && edge.targetHandle === 'index');
    if (!indexEdge) return undefined;

    const nodesById = new Map(nodes.map((n) => [n.id, n]));
    const rawSource = nodesById.get(indexEdge.source);
    if (!rawSource) return undefined;

    const sourceNode = resolveEffectiveSourceNode(rawSource, nodesById, edges, indexEdge.sourceHandle);
    if (!sourceNode) return undefined;

    const textVal = evaluateNodeTextForMonitor(sourceNode.id, nodes, edges, new Set([id]));

    if (textVal) {
      const parsed = parseInt(textVal.trim(), 10);
      if (!isNaN(parsed)) {
        return parsed - 1; // Subtract 1 to convert from user's 1-based numbering to 0-based indexing
      }
    }
    return undefined;
  }, [id, nodes, edges]);

  const isControlled = dynamicIndex !== undefined;
  const activeIndex = isControlled ? dynamicIndex : selectedIndex;

  const setSelectedIndex = (nextIndex: number) => {
    if (isControlled) return;
    const item = items[Math.max(0, Math.min(items.length - 1, nextIndex))];
    data.onChange?.('expandedItemIndex', item?.index ?? 0);
  };

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[9px] font-bold text-gray-500 ml-2">LIST</span>
        <span className="text-[9px] font-bold text-gray-500 ml-2">INDEX</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id={undefined}
        style={{ top: '32%', background: '#eab308', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="index"
        className="!rounded-none"
        style={{ top: '68%', background: '#0ea5e9', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="expander"
      icon={ChevronsRight}
      title="Expander"
      hasInput={false}
      customHandles={customHandles}
      outputActions={getCompatibleNodeActions('expander')}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="grid grid-cols-2 gap-2">
        <SummaryCard label="Items" value={String(items.length)} />
        <SummaryCard label="Selected" value={selectedItem ? String(selectedOrdinal + 1) : 'None'} />
      </div>

      <div className="rounded-lg border border-gray-700/60 bg-[#111217]/35 p-2">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
          Output Item
        </div>
        {items.length > 0 ? (
          <div className="space-y-2">
            <select
              className={`nodrag w-full rounded-md border border-gray-700 bg-[#0d0f15] px-2 py-1.5 text-xs text-gray-100 ${isControlled ? 'cursor-not-allowed text-gray-500 border-gray-800 bg-[#0b0c10]' : ''}`}
              onChange={(event) => data.onChange?.('expandedItemIndex', Number(event.target.value))}
              disabled={isControlled}
              value={activeIndex}
            >
              {items.map((item: FlowListItem, idx: number) => (
                <option key={`${item.id}-${item.index}-${idx}`} value={item.index}>
                  {item.index + 1}. {item.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <button
                className={`nodrag flex h-7 w-7 items-center justify-center rounded-md border border-gray-700 bg-[#0d0f15] text-gray-300 hover:border-yellow-300/50 hover:text-white disabled:opacity-40 ${isControlled ? 'cursor-not-allowed bg-transparent text-gray-600 border-gray-800' : ''}`}
                disabled={isControlled || selectedOrdinal <= 0}
                onClick={() => setSelectedIndex(selectedOrdinal - 1)}
                title="Previous item"
                type="button"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                className={`nodrag flex h-7 w-7 items-center justify-center rounded-md border border-gray-700 bg-[#0d0f15] text-gray-300 hover:border-yellow-300/50 hover:text-white disabled:opacity-40 ${isControlled ? 'cursor-not-allowed bg-transparent text-gray-600 border-gray-800' : ''}`}
                disabled={isControlled || selectedOrdinal < 0 || selectedOrdinal >= items.length - 1}
                onClick={() => setSelectedIndex(selectedOrdinal + 1)}
                title="Next item"
                type="button"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            {isControlled && (
              <div className="flex items-center gap-1.5 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[10px] text-amber-300 font-medium mt-1">
                <Cpu size={12} className="animate-pulse" />
                <span>Driven by upstream index ({activeIndex + 1})</span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-gray-700/60 bg-[#0d0f15] px-2 py-3 text-center text-[11px] text-gray-500">
            Connect a list or envelope
          </div>
        )}
      </div>

      {selectedItem ? (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-300/25 bg-yellow-300/10 px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-yellow-300/30 bg-[#0d0f15] text-yellow-100">
            <KindIcon kind={selectedItem.kind} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-gray-100">{selectedItem.label}</div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-gray-500">
              {selectedItem.kind} output
            </div>
          </div>
        </div>
      ) : null}

      {selectedItem && selectedPreviewKind ? (
        <div className="overflow-hidden rounded-lg border border-yellow-300/20 bg-[#0d0f15]">
          {selectedPreviewKind === 'image' ? (
            <img
              alt={selectedItem.label}
              className="h-28 w-full object-cover"
              draggable={false}
              src={selectedItem.value}
            />
          ) : (
            <video
              className="h-28 w-full object-cover"
              muted
              playsInline
              preload="metadata"
              src={selectedItem.value}
            />
          )}
        </div>
      ) : null}
    </BaseNode>
  );
}

export const ExpanderNode = memo(ExpanderNodeComponent);

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
    case 'package':
      return <Archive size={14} />;
  }
}
