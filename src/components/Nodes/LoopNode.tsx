import { memo } from 'react';
import { Repeat } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { NodeHelpText } from './NodeHelpText';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function LoopNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const count = Number.isInteger(data.count) ? Math.max(1, Number(data.count)) : 5;

  const handleCountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextCount = parseInt(event.target.value, 10);
    if (!isNaN(nextCount)) {
      patchNodeData(id, { count: Math.max(1, nextCount) });
    }
  };

  return (
    <BaseNode
      nodeId={id}
      nodeType="loopNode"
      icon={Repeat}
      title="Simple Loop"
      hasInput={true}
      hasOutput={true}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-gray-200">
            Loop Multiplier:
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              max="50"
              value={count}
              onChange={handleCountChange}
              className="w-16 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-center font-bold text-gray-100 focus:border-amber-500 focus:outline-none"
            />
            <span className="font-semibold text-gray-400">runs</span>
          </div>
        </div>
        <NodeHelpText helpKey="loopNode" summary={`Repeats the upstream item ${count}x`}>
          Repeats the upstream connected item <span className="text-amber-400 font-bold">{count} times</span> into a loop list. Connect this node downstream to run generation batches and select the best run.
        </NodeHelpText>
      </div>
    </BaseNode>
  );
}

export const LoopNode = memo(LoopNodeComponent);
