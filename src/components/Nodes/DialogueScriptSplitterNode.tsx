import { memo } from 'react';
import { Type } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function DialogueScriptSplitterNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const prefix = (data.prefix as string) ?? 'MARA:';

  return (
    <BaseNode
      nodeId={id}
      nodeType="dialogueScriptSplitterNode"
      icon={Type}
      title="Dialogue Script Splitter"
      hasInput={true}
      hasOutput={true}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Character Prefix Tag:</label>
          <input
            type="text"
            value={prefix}
            onChange={(e) => patchNodeData(id, { prefix: e.target.value })}
            placeholder="MARA:"
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 outline-none focus:border-purple-400 font-mono"
          />
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Parses a full screenplay text script, filtering out and returning only the dialogue lines that begin with your character prefix tag.
        </div>
      </div>
    </BaseNode>
  );
}

export const DialogueScriptSplitterNode = memo(DialogueScriptSplitterNodeComponent);
