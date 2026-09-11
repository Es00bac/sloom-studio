import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Database } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function SqlQueryNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const query = (data.query as string) ?? 'SELECT * FROM A';

  const handleQueryChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    patchNodeData(id, { query: event.target.value });
  };

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[10px] font-bold text-indigo-400 ml-2">A</span>
        <span className="text-[10px] font-bold text-cyan-400 ml-2">B</span>
        <span className="text-[10px] font-bold text-gray-400 ml-2">Q</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="A"
        className="!rounded-none"
        style={{ top: '25%', background: '#6366f1', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="B"
        className="!rounded-none"
        style={{ top: '50%', background: '#06b6d4', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="query"
        className="!rounded-none"
        style={{ top: '75%', background: '#6b7280', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="sqlQueryNode"
      icon={Database}
      title="SQL Query"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs w-[280px]">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">SELECT Query:</label>
          <textarea
            value={query}
            onChange={handleQueryChange}
            rows={5}
            placeholder="SELECT * FROM A"
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 focus:border-indigo-400 focus:outline-none resize-y"
          />
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Executes SELECT queries and JOINs on lists <code className="text-indigo-400 font-mono">A</code> and <code className="text-cyan-400 font-mono">B</code>.
          <div className="mt-1.5 text-[10px] text-gray-500 font-mono bg-black/40 p-1.5 rounded border border-gray-800">
            e.g., SELECT A.title, B.price FROM A JOIN B ON A.id = B.productId WHERE A.status = 'live'
          </div>
        </div>
      </div>
    </BaseNode>
  );
}

export const SqlQueryNode = memo(SqlQueryNodeComponent);
