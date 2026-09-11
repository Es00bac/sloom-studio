import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Link2 } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function PromptsJoinerNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const delimiter = (data.delimiter as string) ?? ', ';

  const handleDelimiterChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    patchNodeData(id, { delimiter: event.target.value });
  };

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[10px] font-bold text-gray-500 ml-2">A</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">B</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">C</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="A"
        style={{ top: '25%', background: '#c084fc', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="B"
        style={{ top: '55%', background: '#c084fc', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="C"
        style={{ top: '80%', background: '#c084fc', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="promptsJoinerNode"
      icon={Link2}
      title="Prompts Joiner"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Delimiter (default is comma):</label>
          <input
            type="text"
            value={delimiter}
            onChange={handleDelimiterChange}
            placeholder=", "
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 outline-none focus:border-purple-400 font-mono"
          />
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Strips, filters, and joins all connected prompt text inputs using your custom delimiter character.
        </div>
      </div>
    </BaseNode>
  );
}

export const PromptsJoinerNode = memo(PromptsJoinerNodeComponent);
