import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Scale } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import type { AppNodeProps } from '../../types/flow';

function FallbackSelectorNodeComponent({ id, data }: AppNodeProps) {
  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[9px] font-bold text-gray-500 ml-2">PRIMARY</span>
        <span className="text-[9px] font-bold text-gray-500 ml-2">FALLBACK</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="primary"
        style={{ top: '32%', background: '#c084fc', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="fallback"
        style={{ top: '68%', background: '#c084fc', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="fallbackSelectorNode"
      icon={Scale}
      title="Fallback Selector"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="leading-5 text-gray-300">
          Selects the first usable value without converting its data type.
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Switches automatically to the <span className="text-purple-400 font-semibold">FALLBACK</span> input value if the <span className="text-purple-400 font-semibold">PRIMARY</span> input is blank or fails.
        </div>
      </div>
    </BaseNode>
  );
}

export const FallbackSelectorNode = memo(FallbackSelectorNodeComponent);
