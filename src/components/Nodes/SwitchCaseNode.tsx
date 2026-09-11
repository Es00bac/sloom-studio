import { memo } from 'react';
import { Position } from '@xyflow/react';
import { GitPullRequest } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function SwitchCaseNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const case1Val = (data.case1Val as string) ?? 'A';
  const case2Val = (data.case2Val as string) ?? 'B';
  const case3Val = (data.case3Val as string) ?? 'C';

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[10px] font-bold text-gray-500 ml-2">KEY</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="key"
        style={{ top: '50%', background: '#c084fc', width: '10px', height: '10px' }}
      />

      <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pr-1">
        <span className="text-[9px] font-bold text-gray-500 mr-2 text-right">CASE 1</span>
        <span className="text-[9px] font-bold text-gray-500 mr-2 text-right">CASE 2</span>
        <span className="text-[9px] font-bold text-gray-500 mr-2 text-right">CASE 3</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="case1"
        style={{ top: '25%', background: '#10b981', width: '10px', height: '10px' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="case2"
        style={{ top: '55%', background: '#10b981', width: '10px', height: '10px' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="case3"
        style={{ top: '80%', background: '#10b981', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="switchCaseNode"
      icon={GitPullRequest}
      title="Switch Case Router"
      hasInput={false}
      hasOutput={false}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Case Values:</label>
          <div className="flex flex-col gap-1 mt-1">
            <div className="flex items-center gap-1.5 justify-between">
              <span className="font-bold text-emerald-400 text-[10px]">1:</span>
              <input
                type="text"
                value={case1Val}
                onChange={(e) => patchNodeData(id, { case1Val: e.target.value })}
                className="rounded-md border border-gray-700 bg-gray-950 px-2 py-0.5 text-xs text-gray-100 focus:border-purple-400 font-mono w-40"
              />
            </div>
            <div className="flex items-center gap-1.5 justify-between">
              <span className="font-bold text-emerald-400 text-[10px]">2:</span>
              <input
                type="text"
                value={case2Val}
                onChange={(e) => patchNodeData(id, { case2Val: e.target.value })}
                className="rounded-md border border-gray-700 bg-gray-950 px-2 py-0.5 text-xs text-gray-100 focus:border-purple-400 font-mono w-40"
              />
            </div>
            <div className="flex items-center gap-1.5 justify-between">
              <span className="font-bold text-emerald-400 text-[10px]">3:</span>
              <input
                type="text"
                value={case3Val}
                onChange={(e) => patchNodeData(id, { case3Val: e.target.value })}
                className="rounded-md border border-gray-700 bg-gray-950 px-2 py-0.5 text-xs text-gray-100 focus:border-purple-400 font-mono w-40"
              />
            </div>
          </div>
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Evaluates the connected KEY value and routes prompts through the corresponding Case branch that matches its value.
        </div>
      </div>
    </BaseNode>
  );
}

export const SwitchCaseNode = memo(SwitchCaseNodeComponent);
