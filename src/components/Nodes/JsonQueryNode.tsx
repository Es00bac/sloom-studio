import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Braces } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';
import { DeclaredOutputTypeSelect } from './DeclaredOutputTypeSelect';

const QUERY_OUTPUT_TYPES = ['text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'list'] as const;

function JsonQueryNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const query = (data.query as string) ?? '';

  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    patchNodeData(id, { query: event.target.value });
  };

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[10px] font-bold text-gray-500 ml-2">json</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">query</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="json"
        className="!rounded-none"
        style={{ top: '32%', background: '#374151', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="query"
        className="!rounded-none"
        style={{ top: '68%', background: '#374151', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="jsonQueryNode"
      icon={Braces}
      title="JSON Query"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs w-[280px]">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Query Path / Expression:</label>
          <input
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder="e.g. store.book[0].title"
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 focus:border-cyan-400 focus:outline-none"
          />
        </div>
        <DeclaredOutputTypeSelect
          allowedTypes={QUERY_OUTPUT_TYPES}
          onChange={(value) => patchNodeData(id, { declaredOutputType: value })}
          value={data.declaredOutputType}
        />
        <div className="mt-1 leading-5 text-gray-400">
          Extracts values from the input <code className="text-cyan-400 font-mono">json</code> object using a JavaScript evaluation path. Supports fields, arrays, and standard array methods.
        </div>
      </div>
    </BaseNode>
  );
}

export const JsonQueryNode = memo(JsonQueryNodeComponent);
