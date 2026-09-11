import { memo } from 'react';
import { LogOut } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps, ResultType } from '../../types/flow';

const PORT_TYPES: Array<ResultType | 'any'> = ['any', 'text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'package', 'list', 'envelope'];

function FunctionOutputNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const portLabel = typeof data.functionPortLabel === 'string' ? data.functionPortLabel : (typeof data.customTitle === 'string' ? data.customTitle : 'Output Port');
  const portKey = typeof data.functionPortKey === 'string' ? data.functionPortKey : slugify(portLabel);
  const portType = typeof data.functionPortType === 'string' ? data.functionPortType : 'any';

  return (
    <BaseNode
      nodeId={id}
      nodeType="functionOutputNode"
      icon={LogOut}
      title="Function Output Marker"
      hasInput={true}
      hasOutput={false}
      error={data.error}
      statusMessage={data.statusMessage}
    >
      <div className="space-y-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs">
        <label className="block">
          <span className="mb-1.5 block font-semibold text-emerald-200">Port Label</span>
          <input
            className={withFlowNodeInteractionClasses('w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-100 outline-none focus:border-emerald-300')}
            onChange={(event) => {
              const val = event.target.value;
              patchNodeData(id, {
                functionPortLabel: val,
                customTitle: val,
                // Automatically keep key in sync if not manually diverged too much
                functionPortKey: slugify(val),
              });
            }}
            placeholder="e.g. Master Video"
            type="text"
            value={portLabel}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block font-semibold text-emerald-200">Port Handle Key</span>
          <input
            className={withFlowNodeInteractionClasses('w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-gray-100 outline-none focus:border-emerald-300')}
            onChange={(event) => {
              patchNodeData(id, {
                functionPortKey: slugify(event.target.value),
              });
            }}
            placeholder="e.g. master_video"
            type="text"
            value={portKey}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block font-semibold text-emerald-200">Port Value Type</span>
          <select
            className={withFlowNodeInteractionClasses('w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-100 outline-none focus:border-emerald-300')}
            onChange={(event) => {
              patchNodeData(id, {
                functionPortType: event.target.value,
              });
            }}
            value={portType}
          >
            {PORT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type === 'any' ? 'Any Type (*)' : capitalize(type)}
              </option>
            ))}
          </select>
        </label>

        <div className="leading-5 text-emerald-100/60">
          This marker defines an <strong>output handle</strong> on your collapsed custom function. Connect its input to the final node inside the group.
        </div>
      </div>
    </BaseNode>
  );
}

export const FunctionOutputNode = memo(FunctionOutputNodeComponent);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
