import { memo } from 'react';
import { Binary } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function NumberNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const value = data.value !== undefined ? String(data.value) : '0';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Allow empty string, decimals, minus sign, etc. during editing. Save as string to avoid breaking active typing.
    patchNodeData(id, { value: val });
  };

  return (
    <BaseNode
      nodeId={id}
      nodeType="numberNode"
      icon={Binary}
      title="Numeric Value"
      hasInput={false}
      hasOutput={true}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Value:</label>
          <input
            type="number"
            step="any"
            value={value}
            onChange={handleChange}
            placeholder="0"
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-gray-100 focus:border-blue-400 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Holds a decimal or integer number to be consumed by math operations, comparison nodes, dynamic list expansions, or other flow conditions.
        </div>
      </div>
    </BaseNode>
  );
}

export const NumberNode = memo(NumberNodeComponent);
