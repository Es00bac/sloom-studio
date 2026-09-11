import { memo } from 'react';
import { Layers3 } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function StoryStateNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const key = (data.key as string) ?? 'injured';
  const value = (data.value as string) ?? 'false';

  return (
    <BaseNode
      nodeId={id}
      nodeType="storyStateNode"
      icon={Layers3}
      title="Story State Setter"
      hasInput={true}
      hasOutput={true}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">State Key:</label>
          <input
            type="text"
            value={key}
            onChange={(e) => patchNodeData(id, { key: e.target.value })}
            placeholder="injured"
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 outline-none focus:border-purple-400 font-mono"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">State Value:</label>
          <input
            type="text"
            value={value}
            onChange={(e) => patchNodeData(id, { value: e.target.value })}
            placeholder="false"
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 outline-none focus:border-purple-400 font-mono"
          />
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Declares and propagates global state parameters across sequential panels to control continuity details.
        </div>
      </div>
    </BaseNode>
  );
}

export const StoryStateNode = memo(StoryStateNodeComponent);
