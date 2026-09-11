import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Braces } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function JsonBuilderNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const template = (data.template as string) ?? '{\n  "status": "success",\n  "data": {\n    "title": "{{A}}",\n    "score": {{B}},\n    "tags": ["{{C}}"]\n  }\n}';

  const handleTemplateChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    patchNodeData(id, { template: event.target.value });
  };

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[9px] font-bold text-gray-500 ml-1">A</span>
        <span className="text-[9px] font-bold text-gray-500 ml-1">B</span>
        <span className="text-[9px] font-bold text-gray-500 ml-1">C</span>
        <span className="text-[9px] font-bold text-gray-500 ml-1">D</span>
        <span className="text-[9px] font-bold text-gray-500 ml-1">E</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="A"
        className="!rounded-none"
        style={{ top: '16.6%', background: '#4b5563', width: '8px', height: '8px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="B"
        className="!rounded-none"
        style={{ top: '33.3%', background: '#4b5563', width: '8px', height: '8px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="C"
        className="!rounded-none"
        style={{ top: '50%', background: '#4b5563', width: '8px', height: '8px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="D"
        className="!rounded-none"
        style={{ top: '66.6%', background: '#4b5563', width: '8px', height: '8px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="E"
        className="!rounded-none"
        style={{ top: '83.3%', background: '#4b5563', width: '8px', height: '8px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="jsonBuilderNode"
      icon={Braces}
      title="JSON Builder"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs w-[280px]">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">JSON Template:</label>
          <textarea
            value={template}
            onChange={handleTemplateChange}
            rows={7}
            placeholder='{\n  "key": "{{A}}"\n}'
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 focus:border-purple-400 focus:outline-none resize-y"
          />
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Replaces placeholders like <code className="text-purple-400 font-mono">{"{{A}}"}</code> with active input values. Automatically serializes arrays and nested objects cleanly.
        </div>
      </div>
    </BaseNode>
  );
}

export const JsonBuilderNode = memo(JsonBuilderNodeComponent);
