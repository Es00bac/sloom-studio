import { memo } from 'react';
import { Position } from '@xyflow/react';
import { FileSearch } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { NodeHelpText } from './NodeHelpText';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function RegexParseNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const regex = (data.regex as string) ?? '';

  const handleRegexChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    patchNodeData(id, { regex: event.target.value });
  };

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[10px] font-bold text-gray-500 ml-2">text</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">regex</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        className="!rounded-none"
        style={{ top: '32%', background: '#374151', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="regex"
        className="!rounded-none"
        style={{ top: '68%', background: '#374151', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="regexParseNode"
      icon={FileSearch}
      title="Regex Parse"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-pink-500/20 bg-pink-500/5 p-3 text-xs w-[280px]">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Regex Pattern:</label>
          <input
            type="text"
            value={regex}
            onChange={handleRegexChange}
            placeholder="e.g. /(\d+)/ or /hello/g"
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 focus:border-pink-400 focus:outline-none"
          />
        </div>
        <NodeHelpText helpKey="regexParseNode" summary="What this node outputs">
          Parses connected text using a Regular Expression pattern. Outputs a single captured match, or a list of matches if the <code className="text-pink-400 font-mono">/g</code> flag is enabled.
        </NodeHelpText>
      </div>
    </BaseNode>
  );
}

export const RegexParseNode = memo(RegexParseNodeComponent);
