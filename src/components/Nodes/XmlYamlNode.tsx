import { memo } from 'react';
import { Position } from '@xyflow/react';
import { FileCode } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function XmlYamlNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const mode = (data.mode as string) ?? 'xml-to-json';

  const handleModeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    patchNodeData(id, { mode: event.target.value });
  };

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[10px] font-bold text-teal-400 ml-2">TXT</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">MD</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        className="!rounded-none"
        style={{ top: '35%', background: '#14b8a6', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="mode"
        className="!rounded-none"
        style={{ top: '65%', background: '#4b5563', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="xmlYamlNode"
      icon={FileCode}
      title="XML/YAML Parser"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-teal-500/20 bg-teal-500/5 p-3 text-xs w-[280px]">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Transformation Mode:</label>
          <select
            value={mode}
            onChange={handleModeChange}
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-sans text-xs text-gray-100 focus:border-teal-400 focus:outline-none"
          >
            <option value="xml-to-json">XML to JSON</option>
            <option value="json-to-xml">JSON to XML</option>
            <option value="yaml-to-json">YAML to JSON</option>
            <option value="json-to-yaml">JSON to YAML</option>
          </select>
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Bidirectionally serializes and parses XML or YAML structures to and from standard JSON.
        </div>
      </div>
    </BaseNode>
  );
}

export const XmlYamlNode = memo(XmlYamlNodeComponent);
