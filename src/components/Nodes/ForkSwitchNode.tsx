import { memo, useMemo } from 'react';
import { Position } from '@xyflow/react';
import { GitFork, Cpu } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function ForkSwitchNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const edges = useFlowStore((state) => state.edges);
  const selectedOutput = (data.selectedOutput as 'A' | 'B') || 'A';

  const isControlled = useMemo(() => {
    return edges.some((edge) => edge.target === id && edge.targetHandle === 'condition');
  }, [id, edges]);

  const selectOutput = (output: 'A' | 'B') => {
    if (isControlled) return;
    patchNodeData(id, { selectedOutput: output });
  };

  const customHandles = (
    <>
      {/* Left side target handles */}
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1 pb-1">
        <span className="text-[8px] font-bold text-gray-500 ml-2">COND (?)</span>
        <span className="text-[8px] font-bold text-gray-500 ml-2">INPUT</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="condition"
        className="!rounded-none"
        style={{
          top: '25%',
          background: '#fbbf24',
          width: '10px',
          height: '10px',
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!rounded-none"
        style={{
          top: '75%',
          background: '#f43f5e',
          width: '12px',
          height: '12px',
        }}
      />

      {/* Right side source handles */}
      <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pr-1">
        <span className="text-[10px] font-bold text-gray-500 mr-2 text-right">A</span>
        <span className="text-[10px] font-bold text-gray-500 mr-2 text-right">B</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="A"
        className="!rounded-none"
        style={{
          top: '32%',
          background: selectedOutput === 'A' ? '#f43f5e' : '#374151',
          width: '10px',
          height: '10px',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="B"
        className="!rounded-none"
        style={{
          top: '68%',
          background: selectedOutput === 'B' ? '#f43f5e' : '#374151',
          width: '10px',
          height: '10px',
        }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="forkSwitchNode"
      icon={GitFork}
      title="Fork Switch"
      hasInput={false}
      hasOutput={false}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <span className="font-semibold text-gray-200">
            Route input to output:
          </span>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              onClick={() => selectOutput('A')}
              disabled={isControlled}
              className={`rounded-lg py-1.5 font-bold transition-all text-xs border ${
                isControlled
                  ? selectedOutput === 'A'
                    ? 'bg-rose-500/10 text-rose-300 border-rose-500/35 cursor-not-allowed'
                    : 'bg-gray-800/20 text-gray-600 border-gray-900 cursor-not-allowed'
                  : selectedOutput === 'A'
                    ? 'bg-rose-500/20 text-white border-rose-500'
                    : 'bg-gray-800/40 text-gray-400 border-gray-700 hover:text-gray-200 hover:border-gray-600'
              }`}
              type="button"
            >
              OUTPUT A
            </button>
            <button
              onClick={() => selectOutput('B')}
              disabled={isControlled}
              className={`rounded-lg py-1.5 font-bold transition-all text-xs border ${
                isControlled
                  ? selectedOutput === 'B'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/35 cursor-not-allowed'
                    : 'bg-gray-800/20 text-gray-600 border-gray-900 cursor-not-allowed'
                  : selectedOutput === 'B'
                    ? 'bg-rose-500/20 text-white border-rose-500'
                    : 'bg-gray-800/40 text-gray-400 border-gray-700 hover:text-gray-200 hover:border-gray-600'
              }`}
              type="button"
            >
              OUTPUT B
            </button>
          </div>
        </div>

        {isControlled && (
          <div className="flex items-center gap-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-[10px] text-emerald-300 font-medium mt-1">
            <Cpu size={12} className="animate-pulse" />
            <span>Driven by upstream logic</span>
          </div>
        )}

        <div className="mt-1 leading-5 text-gray-400">
          The selected output branch will receive the incoming chain of execution; the inactive branch is disconnected.
        </div>
      </div>
    </BaseNode>
  );
}

export const ForkSwitchNode = memo(ForkSwitchNodeComponent);
