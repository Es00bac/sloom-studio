import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function PromptMixerNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const weight = Number(data.weight ?? 50);

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[10px] font-bold text-gray-500 ml-2">A</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">B</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="A"
        style={{ top: '35%', background: '#c084fc', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="B"
        style={{ top: '65%', background: '#c084fc', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="promptMixerNode"
      icon={Sparkles}
      title="Prompt Mixer"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between font-semibold text-gray-200">
            <span>Blend Weight:</span>
            <span className="text-purple-400 font-mono">{weight}% A / {100 - weight}% B</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={weight}
            onChange={(e) => patchNodeData(id, { weight: Number(e.target.value) })}
            className="w-full accent-purple-500 h-1 bg-gray-700 rounded-lg cursor-pointer"
          />
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Interpolates or blends prompt properties from two separate input character paths.
        </div>
      </div>
    </BaseNode>
  );
}

export const PromptMixerNode = memo(PromptMixerNodeComponent);
