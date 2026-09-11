import { memo } from 'react';
import { Position } from '@xyflow/react';
import { RefreshCw } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import type { AppNodeProps } from '../../types/flow';

function LoopGateNodeComponent({ id, data }: AppNodeProps) {
  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[9px] font-bold text-gray-500 ml-2">INPUT</span>
        <span className="text-[9px] font-bold text-gray-500 ml-2">IF (?)</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!rounded-none"
        style={{ top: '32%', background: '#374151', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="condition"
        className="!rounded-none"
        style={{ top: '68%', background: '#fbbf24', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="loopGateNode"
      icon={RefreshCw}
      title="Boolean Gate"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="mt-1 leading-5 text-gray-400">
          Passes INPUT when IF (?) is true and emits an empty value when false. Use Loop to repeat values; this node only gates one value.
        </div>
      </div>
    </BaseNode>
  );
}

export const LoopGateNode = memo(LoopGateNodeComponent);
