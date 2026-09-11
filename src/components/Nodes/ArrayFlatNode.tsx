import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Box } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { NodeHelpText } from './NodeHelpText';
import type { AppNodeProps } from '../../types/flow';

function ArrayFlatNodeComponent({ id, data }: AppNodeProps) {
  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[10px] font-bold text-gray-500 ml-2">L1</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">L2</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">L3</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="L1"
        style={{ top: '25%', background: '#c084fc', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="L2"
        style={{ top: '55%', background: '#c084fc', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="L3"
        style={{ top: '80%', background: '#c084fc', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="arrayFlatNode"
      icon={Box}
      title="List Flattener"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="leading-5 text-gray-300">
          Combines nested sub-lists or individual prompt pools into one continuous flat list.
        </div>
        <NodeHelpText helpKey="arrayFlatNode" summary="How to connect inputs">
          Connect your nested lists to <span className="text-purple-400 font-semibold">L1, L2, L3</span> inputs.
        </NodeHelpText>
      </div>
    </BaseNode>
  );
}

export const ArrayFlatNode = memo(ArrayFlatNodeComponent);
