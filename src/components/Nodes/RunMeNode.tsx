import { memo } from 'react';
import { Play } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function RunMeNodeComponent({ id, data }: AppNodeProps) {
  const runNode = useFlowStore((state) => state.runNode);

  const handleRun = () => {
    void runNode(id);
  };

  return (
    <BaseNode
      nodeId={id}
      nodeType="runMeNode"
      icon={Play}
      title="RUN ME Trigger"
      hasInput={true}
      hasOutput={false}
      onRun={handleRun}
      isRunning={data.isRunning}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs">
        <div className="leading-5 text-gray-300 font-medium">
          Connect the output of any node or envelope to this trigger's input.
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Click the <span className="text-emerald-400 font-semibold">Run</span> button below (or on the node header) to recursively execute the entire upstream chain connected into it!
        </div>
      </div>
    </BaseNode>
  );
}

export const RunMeNode = memo(RunMeNodeComponent);
