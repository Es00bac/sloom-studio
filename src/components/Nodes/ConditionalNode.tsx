import { memo } from 'react';
import { Position } from '@xyflow/react';
import { HelpCircle } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import type { AppNodeProps } from '../../types/flow';

function ConditionalNodeComponent({ id, data }: AppNodeProps) {
  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1 pb-1">
        <span className="text-[8px] font-bold text-gray-500 ml-2">IF (?)</span>
        <span className="text-[8px] font-bold text-gray-500 ml-2">TRUE (✓)</span>
        <span className="text-[8px] font-bold text-gray-500 ml-2">FALSE (✗)</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="condition"
        className="!rounded-none"
        style={{ top: '25%', background: '#fbbf24', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="valueIfTrue"
        className="sl-handle-triangle"
        style={{ top: '55%', background: '#10b981', width: '12px', height: '12px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="valueIfFalse"
        className="sl-handle-triangle"
        style={{ top: '80%', background: '#ef4444', width: '12px', height: '12px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="conditionalNode"
      icon={HelpCircle}
      title="Conditional If/Else"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-3 text-xs">
        <div className="leading-5 text-gray-300">
          Routes values dynamically based on the input condition.
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          If the <span className="text-amber-400">IF (?)</span> input evaluates to <span className="text-emerald-400 font-bold">"true"</span>, it routes <span className="text-emerald-400 font-semibold">TRUE (✓)</span>; otherwise it routes <span className="text-rose-400 font-semibold">FALSE (✗)</span> to output.
        </div>
      </div>
    </BaseNode>
  );
}

export const ConditionalNode = memo(ConditionalNodeComponent);
