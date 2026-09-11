import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Calculator } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function MathNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const operation = (data.operation as string) ?? '+';

  const handleOperationChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    patchNodeData(id, { operation: event.target.value });
  };

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
        className="!rounded-none"
        style={{ top: '32%', background: '#374151', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="B"
        className="!rounded-none"
        style={{ top: '68%', background: '#374151', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="mathNode"
      icon={Calculator}
      title="Math Operator"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Operation:</label>
          <select
            value={operation}
            onChange={handleOperationChange}
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-100 focus:border-purple-400 focus:outline-none"
          >
            <option value="+">A + B (Addition)</option>
            <option value="-">A - B (Subtraction)</option>
            <option value="*">A * B (Multiplication)</option>
            <option value="/">A / B (Division)</option>
            <option value="modulo">A % B (Modulo)</option>
          </select>
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Performs basic arithmetic on connected numeric values, outputting the calculated value as a text string.
        </div>
      </div>
    </BaseNode>
  );
}

export const MathNode = memo(MathNodeComponent);
