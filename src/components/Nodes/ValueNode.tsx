import { memo } from 'react';
import { Braces, Database, Hash, ToggleRight, Type } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { isFlowPrimitiveKind, type FlowPrimitiveKind } from '../../lib/flowValueTypes';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

const VALUE_KINDS: FlowPrimitiveKind[] = ['text', 'number', 'boolean', 'json'];

function ValueNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const valueKind = isFlowPrimitiveKind(data.valueKind) ? data.valueKind : 'text';
  const value = data.value ?? defaultValueForKind(valueKind);

  return (
    <BaseNode
      nodeId={id}
      nodeType="valueNode"
      icon={iconForKind(valueKind)}
      title={`${capitalize(valueKind)} Value`}
      hasInput={false}
      hasOutput
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="space-y-3 rounded-lg border border-teal-400/20 bg-teal-400/5 p-3 text-xs">
        <label className="block">
          <span className="mb-1.5 block font-semibold text-gray-200">Type</span>
          <select
            className={withFlowNodeInteractionClasses('w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-100 outline-none focus:border-teal-300')}
            onChange={(event) => {
              const nextKind = isFlowPrimitiveKind(event.target.value) ? event.target.value : 'text';
              patchNodeData(id, {
                valueKind: nextKind,
                value: defaultValueForKind(nextKind),
              });
            }}
            value={valueKind}
          >
            {VALUE_KINDS.map((kind) => (
              <option key={kind} value={kind}>{capitalize(kind)}</option>
            ))}
          </select>
        </label>

        {valueKind === 'boolean' ? (
          <label className={withFlowNodeInteractionClasses('flex items-center justify-between rounded-md border border-gray-700 bg-gray-950 px-2 py-2 text-gray-100')}>
            <span className="font-semibold">Value</span>
            <input
              checked={Boolean(value)}
              onChange={(event) => patchNodeData(id, { value: event.target.checked })}
              type="checkbox"
            />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1.5 block font-semibold text-gray-200">Value</span>
            <textarea
              className={withFlowNodeInteractionClasses('min-h-20 w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-xs leading-5 text-gray-100 outline-none focus:border-teal-300')}
              onChange={(event) => {
                const raw = event.target.value;
                patchNodeData(id, {
                  value: valueKind === 'number' ? Number(raw) : raw,
                });
              }}
              rows={valueKind === 'json' ? 5 : 3}
              value={valueKind === 'json' && typeof value !== 'string' ? JSON.stringify(value, null, 2) : String(value)}
            />
          </label>
        )}

        <div className="leading-5 text-gray-400">
          Outputs a typed primitive that can feed templates, comparisons, logic, lists, envelopes, and functions.
        </div>
      </div>
    </BaseNode>
  );
}

export const ValueNode = memo(ValueNodeComponent);

function defaultValueForKind(kind: FlowPrimitiveKind): string | number | boolean {
  if (kind === 'number') return 0;
  if (kind === 'boolean') return false;
  if (kind === 'json') return '{}';
  return '';
}

function iconForKind(kind: FlowPrimitiveKind) {
  if (kind === 'text') return Type;
  if (kind === 'number') return Hash;
  if (kind === 'boolean') return ToggleRight;
  if (kind === 'json') return Braces;
  return Database;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
