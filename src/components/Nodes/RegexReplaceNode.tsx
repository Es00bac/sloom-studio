import { memo } from 'react';
import { RefreshCw } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function RegexReplaceNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const pattern = (data.pattern as string) ?? '';
  const replacement = (data.replacement as string) ?? '';

  const handlePatternChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    patchNodeData(id, { pattern: event.target.value });
  };

  const handleReplacementChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    patchNodeData(id, { replacement: event.target.value });
  };

  return (
    <BaseNode
      nodeId={id}
      nodeType="regexReplaceNode"
      icon={RefreshCw}
      title="Regex Replace"
      hasInput={true}
      hasOutput={true}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Find Pattern (Regex):</label>
          <input
            type="text"
            value={pattern}
            onChange={handlePatternChange}
            placeholder="\bmodern\b"
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 outline-none focus:border-purple-400 font-mono"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Replace With:</label>
          <input
            type="text"
            value={replacement}
            onChange={handleReplacementChange}
            placeholder="steampunk"
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 outline-none focus:border-purple-400 font-mono"
          />
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Replaces matching regular expressions inside the connected description text with your custom replacement string.
        </div>
      </div>
    </BaseNode>
  );
}

export const RegexReplaceNode = memo(RegexReplaceNodeComponent);
