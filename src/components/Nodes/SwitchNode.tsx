import { memo, useMemo } from 'react';
import { ToggleLeft, ToggleRight, Cpu } from 'lucide-react';
import { Position } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function SwitchNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const edges = useFlowStore((state) => state.edges);
  const state = (data.state as 'on' | 'off') || 'on';

  const isControlled = useMemo(() => {
    return edges.some((edge) => edge.target === id && edge.targetHandle === 'condition');
  }, [id, edges]);

  const handleToggle = () => {
    if (isControlled) return;
    patchNodeData(id, { state: state === 'on' ? 'off' : 'on' });
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
          background: '#fb923c',
          width: '12px',
          height: '12px',
        }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="switchNode"
      icon={state === 'on' ? ToggleRight : ToggleLeft}
      title="On/Off Switch"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-orange-400/25 bg-orange-500/5 p-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-gray-200">
            Switch: <span className={state === 'on' ? 'text-emerald-400' : 'text-rose-400 font-bold'}>{state.toUpperCase()}</span>
          </span>
          <button
            onClick={handleToggle}
            disabled={isControlled}
            className={`rounded-lg px-3 py-1.5 font-bold transition-all text-xs border ${
              isControlled
                ? 'bg-gray-800/40 text-gray-500 border-gray-800 cursor-not-allowed'
                : state === 'on'
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/30 hover:bg-rose-500/25'
                  : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
            }`}
            type="button"
          >
            {isControlled ? 'LOCKED' : state === 'on' ? 'TURN OFF' : 'TURN ON'}
          </button>
        </div>

        {isControlled && (
          <div className="flex items-center gap-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-[10px] text-emerald-300 font-medium">
            <Cpu size={12} className="animate-pulse" />
            <span>Driven by upstream logic</span>
          </div>
        )}

        <div className="mt-1 leading-5 text-gray-400">
          When <span className="text-rose-400">OFF</span>, it completely disconnects the chain of execution and resolves upstream as disconnected/empty.
        </div>
      </div>
    </BaseNode>
  );
}

export const SwitchNode = memo(SwitchNodeComponent);
