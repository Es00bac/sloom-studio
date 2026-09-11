import { memo } from 'react';
import { Hash } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { NodeHelpText } from './NodeHelpText';
import type { AppNodeProps } from '../../types/flow';

function ListLengthNodeComponent({ id, data }: AppNodeProps) {
  return (
    <BaseNode
      nodeId={id}
      nodeType="listLengthNode"
      icon={Hash}
      title="List Length Counter"
      hasInput={true}
      hasOutput={true}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="leading-5 text-gray-300">
          Counts the number of items currently stored in the connected list or envelope.
        </div>
        <NodeHelpText helpKey="listLengthNode" summary="How to connect and read output">
          Connect a list or envelope output to this node's input, and it will output the count as a numeric string (e.g. <span className="text-purple-400 font-bold">"4"</span>).
        </NodeHelpText>
      </div>
    </BaseNode>
  );
}

export const ListLengthNode = memo(ListLengthNodeComponent);
