import { memo } from 'react';
import { Archive, ExternalLink } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { useEditorStore } from '../../store/editorStore';
import { useSourceBinStore } from '../../store/sourceBinStore';
import { useFlowStore } from '../../store/flowStore';
import { useShallow } from 'zustand/react/shallow';
import type { AppNodeProps } from '../../types/flow';

const actionButtonClassName = withFlowNodeInteractionClasses(
  'inline-flex items-center gap-1 rounded-lg border border-gray-700/60 bg-[#111217]/40 px-2.5 py-1.5 text-[11px] font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white',
);

function SourceBinNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const openEditorForSourceBin = useEditorStore((state) => state.openEditorForSourceBin);
  const bins = useSourceBinStore(useShallow((state) => state.bins));
  
  const selectedBinId = (data?.targetBinId as string) || (bins[0]?.id ?? '');
  const activeBin = bins.find((bin) => bin.id === selectedBinId) || bins[0];
  const items = activeBin ? activeBin.items : [];

  const counts = items.reduce<Record<string, number>>((current, item) => {
    current[item.kind] = (current[item.kind] ?? 0) + 1;
    return current;
  }, {});

  const activeBinId = activeBin?.id ?? id;

  return (
    <BaseNode
      nodeId={id}
      nodeType="sourceBin"
      icon={Archive}
      title="Source Bin"
      hasOutput={false}
      error={data?.error}
      statusMessage={data?.statusMessage}
      retryState={data?.retryState}
      footerActions={
        <button
          className={actionButtonClassName}
          onClick={() => openEditorForSourceBin(activeBinId)}
          type="button"
        >
          <ExternalLink size={12} />
          Open in Video
        </button>
      }
    >
      <div className="space-y-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs">
        <label className="block">
          <span className="mb-1.5 block font-semibold text-blue-100">Target Bin</span>
          <select
            className={withFlowNodeInteractionClasses(
              'w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-100 outline-none focus:border-blue-400'
            )}
            onChange={(event) => {
              const nextBinId = event.target.value;
              patchNodeData(id, { targetBinId: nextBinId });
              // Update active flow source bin in the editor store
              useEditorStore.getState().setActiveFlowSourceBinId(nextBinId);
            }}
            value={selectedBinId}
          >
            {bins.length > 0 ? (
              bins.map((bin) => (
                <option key={bin.id} value={bin.id}>
                  {bin.name || `Bin — ${bin.id.slice(0, 6)}`}
                </option>
              ))
            ) : (
              <option value="">No Bins Available</option>
            )}
          </select>
        </label>
        
        <div className="leading-5 text-blue-100/70">
          Connect outputs here to feed the selected target bin. Parallel source-bin nodes can target different bins.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CountCard label="Items" value={items.length} />
        <CountCard label="Video" value={(counts.video ?? 0) + (counts.composition ?? 0)} />
        <CountCard label="Image" value={counts.image ?? 0} />
        <CountCard label="Audio" value={counts.audio ?? 0} />
        <CountCard label="Docs" value={(counts.document ?? 0) + (counts.subtitle ?? 0) + (counts.package ?? 0)} />
      </div>

      <div className="rounded-lg border border-gray-700/60 bg-[#111217]/35 p-2">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
          Contents
        </div>
        <div className="space-y-1">
          {items.length > 0 ? (
            items.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-md border border-gray-700/60 bg-[#0d0f15] px-2 py-1.5 text-[11px] text-gray-300">
                <span className="mr-2 uppercase tracking-[0.14em] text-gray-500">{item.kind}</span>
                {item.label}
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-gray-700/60 bg-[#0d0f15] px-2 py-3 text-center text-[11px] text-gray-500">
              Connect or import media into the target bin
            </div>
          )}
        </div>
      </div>
    </BaseNode>
  );
}

export const SourceBinNode = memo(SourceBinNodeComponent);

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-700/60 bg-[#111217]/35 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-100">{value}</div>
    </div>
  );
}
