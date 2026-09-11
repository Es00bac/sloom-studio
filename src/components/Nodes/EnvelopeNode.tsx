import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Archive, Braces, Copy, Hash, Image as ImageIcon, Layers3, List, Music2, Plus, Trash2, ToggleRight, Type, Video } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { getCompatibleNodeActions } from '../../lib/nodeActionMenu';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import {
  collectEnvelopeItemsForEnvelopeNode,
  normalizeEnvelopeItems,
} from '../../lib/listNodes';
import {
  createManualEnvelopeItem,
  normalizeEnvelopeItemKind,
  parseManualEnvelopeValue,
  type EnvelopeItemKind,
} from '../../lib/flowValueTypes';
import { normalizeFlowVariableName } from '../../lib/flowVariables';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps, EnvelopeItem, ResultType } from '../../types/flow';

const RESULT_KIND_OPTIONS: ResultType[] = ['text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'package', 'list', 'envelope'];
const ENVELOPE_KIND_OPTIONS: EnvelopeItemKind[] = ['mixed', ...RESULT_KIND_OPTIONS];

function EnvelopeNodeComponent({ id, data }: AppNodeProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const manualItems = useMemo(() => normalizeEnvelopeItems(data.envelopeItems), [data.envelopeItems]);
  const items = useMemo(
    () => collectEnvelopeItemsForEnvelopeNode(id, nodes, edges),
    [edges, id, nodes],
  );
  const selectedKind = normalizeEnvelopeItemKind(data.envelopeItemKind);
  const validItems = items.filter((item) => !item.invalidReason);
  const invalidItems = items.filter((item) => item.invalidReason);
  const kindCounts = items.reduce<Record<ResultType, number>>((counts, item) => {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    return counts;
  }, { text: 0, number: 0, boolean: 0, json: 0, image: 0, video: 0, audio: 0, package: 0, list: 0, envelope: 0 });

  const setManualItems = (nextItems: EnvelopeItem[]) => {
    patchNodeData(id, {
      envelopeItems: nextItems.map((item, index) => ({ ...item, index })),
    });
  };

  const addManualItem = () => {
    const kind = selectedKind === 'mixed' ? 'text' : selectedKind;
    setManualItems([
      ...manualItems,
      createManualEnvelopeItem({ index: manualItems.length, kind }),
    ]);
  };

  return (
    <BaseNode
      nodeId={id}
      nodeType="envelope"
      icon={Layers3}
      title={selectedKind === 'mixed' ? 'Envelope' : `${capitalizeKind(selectedKind)} Envelope`}
      outputActions={getCompatibleNodeActions('envelope')}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="grid grid-cols-4 gap-2">
        <SummaryCard label="Type" value={selectedKind === 'mixed' ? 'Mixed' : capitalizeKind(selectedKind)} />
        <SummaryCard label="Items" value={String(validItems.length)} />
        <SummaryCard label="Manual" value={String(manualItems.length)} />
        <SummaryCard label="Warnings" value={String(invalidItems.length)} />
      </div>

      <div className="rounded-lg border border-purple-400/20 bg-purple-400/5 p-2">
        <label className="mb-2 block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Variable</span>
          <input
            className={withFlowNodeInteractionClasses('w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 outline-none focus:border-purple-300')}
            onBlur={(event) => patchNodeData(id, { flowVariableName: normalizeFlowVariableName(event.target.value) })}
            onChange={(event) => patchNodeData(id, { flowVariableName: event.target.value })}
            placeholder="variable_name"
            value={data.flowVariableName ?? ''}
          />
        </label>
        <div className="mb-2 flex items-center justify-between gap-2">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">Envelope item type</span>
            <select
              className={withFlowNodeInteractionClasses('w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-purple-300')}
              onChange={(event) => patchNodeData(id, { envelopeItemKind: normalizeEnvelopeItemKind(event.target.value) })}
              value={selectedKind}
            >
              {ENVELOPE_KIND_OPTIONS.map((kind) => (
                <option key={kind} value={kind}>{kind === 'mixed' ? 'Mixed' : capitalizeKind(kind)}</option>
              ))}
            </select>
          </label>
          <button
            className={withFlowNodeInteractionClasses('mt-5 inline-flex items-center gap-1.5 rounded-md border border-purple-300/35 bg-purple-300/10 px-2 py-1.5 text-[11px] font-semibold text-purple-50 transition-colors hover:border-purple-200')}
            onClick={addManualItem}
            type="button"
          >
            <Plus size={12} />
            Item
          </button>
        </div>

        <div className="space-y-1.5">
          {manualItems.length > 0 ? manualItems.map((item, index) => (
            <ManualEnvelopeRow
              item={item}
              index={index}
              key={item.id}
              onChange={(patch) => {
                setManualItems(manualItems.map((entry) => entry.id === item.id ? { ...entry, ...patch } : entry));
              }}
              onDelete={() => setManualItems(manualItems.filter((entry) => entry.id !== item.id))}
              onDuplicate={() => {
                setManualItems([
                  ...manualItems.slice(0, index + 1),
                  { ...item, id: `manual-envelope-item-${Date.now()}`, label: `${item.label} copy` },
                  ...manualItems.slice(index + 1),
                ]);
              }}
              onMove={(direction) => {
                const nextIndex = index + direction;
                if (nextIndex < 0 || nextIndex >= manualItems.length) return;
                const next = [...manualItems];
                const [moved] = next.splice(index, 1);
                if (!moved) return;
                next.splice(nextIndex, 0, moved);
                setManualItems(next);
              }}
            />
          )) : (
            <div className="rounded-md border border-dashed border-gray-700/60 bg-[#0d0f15] px-2 py-3 text-center text-[11px] text-gray-500">
              Add editable text, number, boolean, JSON, or media-reference rows here.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2">
        <CountCard icon={<ImageIcon size={12} />} label="Img" value={kindCounts.image} />
        <CountCard icon={<Video size={12} />} label="Vid" value={kindCounts.video} />
        <CountCard icon={<Music2 size={12} />} label="Aud" value={kindCounts.audio} />
        <CountCard icon={<Type size={12} />} label="Txt" value={kindCounts.text} />
        <CountCard icon={<Hash size={12} />} label="#" value={kindCounts.number} />
      </div>

      <div className="rounded-lg border border-gray-700/60 bg-[#111217]/35 p-2">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
          Contents
        </div>
        <div className="space-y-1.5">
          {items.length > 0 ? (
            items.slice(0, 8).map((item) => <EnvelopeRow item={item} key={item.id} />)
          ) : (
            <div className="rounded-md border border-dashed border-gray-700/60 bg-[#0d0f15] px-2 py-3 text-center text-[11px] text-gray-500">
              Connect a list-driven node or add manual typed rows
            </div>
          )}
          {items.length > 8 ? (
            <div className="rounded-md border border-gray-700/60 bg-[#0d0f15] px-2 py-1.5 text-[11px] text-gray-400">
              +{items.length - 8} more
            </div>
          ) : null}
        </div>
      </div>
    </BaseNode>
  );
}

export const EnvelopeNode = memo(EnvelopeNodeComponent);

function ManualEnvelopeRow({
  index,
  item,
  onChange,
  onDelete,
  onDuplicate,
  onMove,
}: {
  index: number;
  item: EnvelopeItem;
  onChange: (patch: Partial<EnvelopeItem>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const parseResult = parseManualEnvelopeValue(item.kind, item.value);

  return (
    <div className="rounded-md border border-gray-700/60 bg-[#0d0f15] p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <select
          className={withFlowNodeInteractionClasses('w-24 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-[11px] text-gray-100 outline-none focus:border-purple-300')}
          onChange={(event) => {
            const kind = event.target.value as ResultType;
            onChange({ kind, mimeType: undefined, value: createManualEnvelopeItem({ index, kind }).value });
          }}
          value={item.kind}
        >
          {RESULT_KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{capitalizeKind(kind)}</option>)}
        </select>
        <input
          className={withFlowNodeInteractionClasses('min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-[11px] text-gray-100 outline-none focus:border-purple-300')}
          onChange={(event) => onChange({ label: event.target.value })}
          placeholder="Label"
          value={item.label}
        />
        <button className="rounded border border-gray-700 px-1.5 py-1 text-gray-400 hover:text-white" onClick={() => onMove(-1)} title="Move up" type="button">↑</button>
        <button className="rounded border border-gray-700 px-1.5 py-1 text-gray-400 hover:text-white" onClick={() => onMove(1)} title="Move down" type="button">↓</button>
        <button className="rounded border border-gray-700 px-1.5 py-1 text-gray-400 hover:text-white" onClick={onDuplicate} title="Duplicate" type="button"><Copy size={11} /></button>
        <button className="rounded border border-red-400/30 px-1.5 py-1 text-red-200 hover:border-red-300" onClick={onDelete} title="Delete" type="button"><Trash2 size={11} /></button>
      </div>
      <textarea
        className={withFlowNodeInteractionClasses('min-h-14 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] leading-4 text-gray-100 outline-none focus:border-purple-300')}
        onChange={(event) => onChange({ value: event.target.value })}
        rows={item.kind === 'json' ? 4 : 2}
        value={item.value}
      />
      {!parseResult.ok ? (
        <div className="mt-1.5 flex items-center gap-1.5 rounded border border-amber-300/25 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-100">
          <AlertTriangle size={11} />
          {parseResult.error}
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

function CountCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-gray-700/60 bg-[#111217]/35 px-2 py-2 text-center">
      <div className="flex items-center justify-center text-gray-300">{icon}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-100">{value}</div>
    </div>
  );
}

function EnvelopeRow({ item }: { item: EnvelopeItem }) {
  return (
    <div className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] ${item.invalidReason ? 'border-amber-300/35 bg-amber-400/10 text-amber-50' : 'border-gray-700/60 bg-[#0d0f15] text-gray-300'}`}>
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-gray-700 bg-[#090a0f] text-gray-300">
        <KindIcon kind={item.kind} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-gray-100">{item.label}</div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-gray-500">
          {item.kind} {item.index + 1}
        </div>
        {item.invalidReason ? <div className="mt-0.5 text-[10px] leading-4 text-amber-100/80">{item.invalidReason}</div> : null}
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: ResultType }) {
  switch (kind) {
    case 'image':
      return <ImageIcon size={13} />;
    case 'video':
      return <Video size={13} />;
    case 'audio':
      return <Music2 size={13} />;
    case 'text':
      return <Type size={13} />;
    case 'boolean':
      return <ToggleRight size={13} />;
    case 'json':
      return <Braces size={13} />;
    case 'package':
      return <Archive size={13} />;
    case 'number':
      return <Hash size={13} />;
    case 'list':
      return <List size={13} />;
    case 'envelope':
      return <Layers3 size={13} />;
  }
}

function capitalizeKind(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
