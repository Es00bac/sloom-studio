import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Code } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';
import { DeclaredOutputTypeSelect } from './DeclaredOutputTypeSelect';

const SCRIPT_OUTPUT_TYPES = ['text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'list'] as const;

function JavaScriptNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const code = (data.code as string) ?? '// Return some value using A, B, C\nreturn A + " " + B;';

  const handleCodeChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    patchNodeData(id, { code: event.target.value });
  };

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[10px] font-bold text-gray-500 ml-2">A</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">B</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">C</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="A"
        className="!rounded-none"
        style={{ top: '25%', background: '#374151', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="B"
        className="!rounded-none"
        style={{ top: '50%', background: '#374151', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="C"
        className="!rounded-none"
        style={{ top: '75%', background: '#374151', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="javascriptNode"
      icon={Code}
      title="JavaScript Script"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-xs w-[280px]">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">JavaScript Code:</label>
          <textarea
            value={code}
            onChange={handleCodeChange}
            rows={6}
            placeholder="// Return value using inputs A, B, C..."
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 focus:border-yellow-400 focus:outline-none resize-y"
          />
        </div>
        <DeclaredOutputTypeSelect
          allowedTypes={SCRIPT_OUTPUT_TYPES}
          onChange={(value) => patchNodeData(id, { declaredOutputType: value })}
          value={data.declaredOutputType}
        />
        <div className="mt-1 leading-5 text-gray-400">
          Evaluates JavaScript code with variables <code className="text-yellow-400 font-mono">A</code>, <code className="text-yellow-400 font-mono">B</code>, and <code className="text-yellow-400 font-mono">C</code>, outputting the returned value.
        </div>
      </div>
    </BaseNode>
  );
}

export const JavaScriptNode = memo(JavaScriptNodeComponent);
