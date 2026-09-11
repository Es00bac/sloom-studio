import { memo } from 'react';
import { RefreshCw } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function SeedSequencerNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const seed = Number(data.seed ?? 12345);
  const increment = Number(data.increment ?? 1);

  return (
    <BaseNode
      nodeId={id}
      nodeType="seedSequencerNode"
      icon={RefreshCw}
      title="Seed Sequencer"
      hasInput={true}
      hasOutput={true}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Base Seed:</label>
          <input
            type="number"
            value={seed}
            onChange={(e) => patchNodeData(id, { seed: Number(e.target.value) })}
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 outline-none focus:border-purple-400 font-mono"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Increment Offset:</label>
          <input
            type="number"
            value={increment}
            onChange={(e) => patchNodeData(id, { increment: Number(e.target.value) })}
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 outline-none focus:border-purple-400 font-mono"
          />
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Maintains stable yet varied panel rendering outputs by incrementing seed parameters systematically.
        </div>
      </div>
    </BaseNode>
  );
}

export const SeedSequencerNode = memo(SeedSequencerNodeComponent);
