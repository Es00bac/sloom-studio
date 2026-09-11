import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Filter } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { NodeHelpText } from './NodeHelpText';
import type { AppNodeProps } from '../../types/flow';

function NegativePromptNodeComponent({ id, data }: AppNodeProps) {
  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[9px] font-bold text-gray-500 ml-2">TEXT</span>
        <span className="text-[9px] font-bold text-gray-500 ml-2">EXCLUDE</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '32%', background: '#c084fc', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="exclude"
        style={{ top: '68%', background: '#f43f5e', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="negativePromptNode"
      icon={Filter}
      title="Negative Prompt Combiner"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="leading-5 text-gray-300">
          Appends the EXCLUDE text as an explicit “Avoid:” instruction after the main prompt.
        </div>
        <NodeHelpText helpKey="negativePromptNode" summary="How to connect TEXT and EXCLUDE">
          Connect your main prompt to the <span className="text-purple-400 font-semibold">TEXT</span> port and words to exclude to the <span className="text-rose-400 font-semibold">EXCLUDE</span> port.
        </NodeHelpText>
      </div>
    </BaseNode>
  );
}

export const NegativePromptNode = memo(NegativePromptNodeComponent);
