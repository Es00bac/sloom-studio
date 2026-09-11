import React, { useMemo, useState } from 'react';
import { Position } from '@xyflow/react';
import { Box, Braces, GitBranch, ListPlus, Plus, Trash2 } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import {
  collectFunctionNodeWarnings,
  createDefaultFunctionNodeConfig,
} from '../../lib/functionNodes';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import type {
  AppNodeProps,
  DynamicValue,
  FunctionBindingSource,
  FunctionInputBinding,
  FunctionNodeConfig,
  FunctionOutputBinding,
  FunctionPortKind,
  FunctionTransformStep,
  FunctionValueKind,
  ResultType,
  TransformKind,
} from '../../types/flow';

const RESULT_TYPES: FunctionValueKind[] = ['any', 'text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'package', 'list', 'envelope'];
const CONSTANT_TYPES: Array<ResultType | 'string' | 'null'> = ['string', 'number', 'boolean', 'json', 'null', 'text', 'image', 'video', 'audio', 'package', 'list', 'envelope'];
const TRANSFORM_TYPES: TransformKind[] = ['trim', 'toText', 'toNumber', 'toBoolean', 'toJson', 'defaultValue', 'prefix', 'suffix', 'replace', 'regexReplace', 'split', 'join', 'take', 'drop', 'template', 'case', 'jsonPath'];

export function FunctionNode({ id, data }: AppNodeProps) {
  const config = data.functionNode ?? createDefaultFunctionNodeConfig('Reusable function');
  const warnings = useMemo(() => collectFunctionNodeWarnings(config), [config]);
  const [tab, setTab] = useState<'contract' | 'inputs' | 'outputs' | 'graph'>('inputs');
  const isCollapsed = Boolean(data.collapsed);

  const updateConfig = (recipe: (draft: FunctionNodeConfig) => void) => {
    const next = cloneConfig(config);
    recipe(next);
    data.onChange?.('functionNode', next);
  };

  const inputPorts = [...config.contract.inputPorts].sort((a, b) => a.order - b.order);
  const outputPorts = [...config.contract.outputPorts].sort((a, b) => a.order - b.order);

  return (
    <BaseNode
      collapsedContent={<FunctionSummary config={config} warnings={warnings.length} />}
      containerClassName="w-[380px]"
      customHandles={<FunctionHandles inputPorts={inputPorts} outputPorts={outputPorts} />}
      hasInput={false}
      hasOutput={false}
      icon={Box}
      isCollapsed={isCollapsed}
      nodeId={id}
      nodeType="functionNode"
      onRun={data.onRun}
      onToggleCollapsed={() => data.onChange?.('collapsed', !isCollapsed)}
      title={config.title || 'Function'}
      error={data.error}
      isRunning={data.isRunning}
      statusMessage={data.statusMessage}
    >
      <div className="space-y-3">
        <FunctionSummary config={config} warnings={warnings.length} />
        <div className={withFlowNodeInteractionClasses('grid grid-cols-4 gap-1 rounded-lg border border-white/10 bg-black/20 p-1 text-[10px]')}>
          {(['contract', 'inputs', 'outputs', 'graph'] as const).map((entry) => (
            <button
              className={`rounded-md px-2 py-1.5 font-semibold uppercase tracking-wide transition-colors ${tab === entry ? 'bg-cyan-300/20 text-cyan-50' : 'text-cyan-100/55 hover:bg-white/10 hover:text-white'}`}
              key={entry}
              onClick={() => setTab(entry)}
              type="button"
            >
              {entry}
            </button>
          ))}
        </div>
        {tab === 'contract' ? (
          <ContractEditor config={config} updateConfig={updateConfig} />
        ) : null}
        {tab === 'inputs' ? (
          <InputBindingsEditor config={config} updateConfig={updateConfig} />
        ) : null}
        {tab === 'outputs' ? (
          <OutputBindingsEditor config={config} updateConfig={updateConfig} />
        ) : null}
        {tab === 'graph' ? (
          <GraphInspector config={config} warnings={warnings} />
        ) : null}
      </div>
    </BaseNode>
  );
}

function FunctionHandles({ inputPorts, outputPorts }: { inputPorts: FunctionPortKind[]; outputPorts: FunctionPortKind[] }) {
  return (
    <>
      {inputPorts.map((port, index) => (
        <Handle
          className="!h-4 !w-4 !rounded-sm !border-2 !border-[#111827] !bg-cyan-300"
          id={port.id}
          key={port.id}
          position={Position.Left}
          style={{ top: 76 + index * 30 }}
          title={port.label}
          type="target"
        />
      ))}
      {outputPorts.map((port, index) => (
        <Handle
          className="!h-4 !w-4 !rounded-sm !border-2 !border-[#111827] !bg-emerald-300"
          id={port.id}
          key={port.id}
          position={Position.Right}
          style={{ top: 76 + index * 30 }}
          title={port.label}
          type="source"
        />
      ))}
    </>
  );
}

function FunctionSummary({ config, warnings }: { config: FunctionNodeConfig; warnings: number }) {
  return (
    <div className="rounded-lg border border-cyan-300/15 bg-[#09131d]/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-cyan-50">{config.title}</div>
          <div className="mt-0.5 text-[11px] text-cyan-100/55">
            {config.contract.inputPorts.length} in · {config.contract.outputPorts.length} out · {config.graph.nodes.length} nodes
          </div>
        </div>
        <div className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${warnings ? 'border-amber-300/35 bg-amber-400/10 text-amber-100' : 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100'}`}>
          {warnings ? `${warnings} warnings` : 'Ready'}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-100/55">
        <span className="rounded bg-white/5 px-2 py-1">Inputs {config.inputBindings.length}</span>
        <span className="rounded bg-white/5 px-2 py-1">Bindings {config.inputBindings.length + config.outputBindings.length}</span>
        <span className="rounded bg-white/5 px-2 py-1">{config.lastRunRuntime?.result ?? 'idle'}</span>
      </div>
    </div>
  );
}

function ContractEditor({
  config,
  updateConfig,
}: {
  config: FunctionNodeConfig;
  updateConfig: (recipe: (draft: FunctionNodeConfig) => void) => void;
}) {
  return (
    <div className={withFlowNodeInteractionClasses('space-y-3')}>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-cyan-100/55">
        Title
        <input
          className="mt-1 w-full rounded-md border border-cyan-300/15 bg-black/25 px-2 py-1.5 text-sm normal-case tracking-normal text-cyan-50 outline-none focus:border-cyan-200/60"
          onChange={(event) => updateConfig((draft) => {
            draft.title = event.target.value;
            draft.contract.title = event.target.value;
          })}
          value={config.title}
        />
      </label>
      <PortTable
        label="Inputs"
        ports={config.contract.inputPorts}
        onAdd={() => updateConfig((draft) => {
          const order = draft.contract.inputPorts.length;
          const port = createPort('input', order);
          draft.contract.inputPorts.push(port);
          draft.inputBindings.push(createInputBinding(port));
        })}
        onRemove={(portId) => updateConfig((draft) => {
          draft.contract.inputPorts = draft.contract.inputPorts.filter((port) => port.id !== portId);
          draft.inputBindings = draft.inputBindings.filter((binding) => binding.targetInputPortId !== portId);
        })}
        onUpdate={(portId, patch) => updateConfig((draft) => {
          const port = draft.contract.inputPorts.find((entry) => entry.id === portId);
          if (port) Object.assign(port, patch);
        })}
      />
      <PortTable
        label="Outputs"
        ports={config.contract.outputPorts}
        onAdd={() => updateConfig((draft) => {
          const order = draft.contract.outputPorts.length;
          const port = createPort('output', order);
          draft.contract.outputPorts.push(port);
          draft.outputBindings.push(createOutputBinding(port));
        })}
        onRemove={(portId) => updateConfig((draft) => {
          draft.contract.outputPorts = draft.contract.outputPorts.filter((port) => port.id !== portId);
          draft.outputBindings = draft.outputBindings.filter((binding) => binding.targetOutputPortId !== portId);
        })}
        onUpdate={(portId, patch) => updateConfig((draft) => {
          const port = draft.contract.outputPorts.find((entry) => entry.id === portId);
          if (port) Object.assign(port, patch);
        })}
      />
    </div>
  );
}

function PortTable({
  label,
  ports,
  onAdd,
  onRemove,
  onUpdate,
}: {
  label: string;
  ports: FunctionPortKind[];
  onAdd: () => void;
  onRemove: (portId: string) => void;
  onUpdate: (portId: string, patch: Partial<FunctionPortKind>) => void;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/15 p-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-cyan-100/60">{label}</div>
        <button className="rounded-md border border-cyan-300/20 p-1 text-cyan-100 hover:border-cyan-200/60" onClick={onAdd} type="button">
          <Plus size={13} />
        </button>
      </div>
      <div className="space-y-2">
        {ports.map((port) => (
          <div className="grid grid-cols-[1fr_86px_24px] gap-1" key={port.id}>
            <input
              className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-cyan-50 outline-none focus:border-cyan-200/50"
              onChange={(event) => onUpdate(port.id, { key: event.target.value, label: event.target.value })}
              value={port.key}
            />
            <select
              className="rounded-md border border-white/10 bg-black/25 px-1 py-1 text-xs text-cyan-50 outline-none"
              onChange={(event) => onUpdate(port.id, { resultType: event.target.value as FunctionValueKind })}
              value={port.resultType}
            >
              {RESULT_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
            <button className="rounded-md text-cyan-100/55 hover:bg-red-400/10 hover:text-red-100" onClick={() => onRemove(port.id)} type="button">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function InputBindingsEditor({
  config,
  updateConfig,
}: {
  config: FunctionNodeConfig;
  updateConfig: (recipe: (draft: FunctionNodeConfig) => void) => void;
}) {
  return (
    <div className={withFlowNodeInteractionClasses('space-y-2')}>
      {config.inputBindings.map((binding) => (
        <BindingCard
          binding={binding}
          key={binding.id}
          port={config.contract.inputPorts.find((port) => port.id === binding.targetInputPortId)}
          updateBinding={(recipe) => updateConfig((draft) => {
            const next = draft.inputBindings.find((entry) => entry.id === binding.id);
            if (next) recipe(next);
          })}
        />
      ))}
    </div>
  );
}

function BindingCard({
  binding,
  port,
  updateBinding,
}: {
  binding: FunctionInputBinding;
  port?: FunctionPortKind;
  updateBinding: (recipe: (draft: FunctionInputBinding) => void) => void;
}) {
  const source = binding.source;
  return (
    <div className="rounded-lg border border-cyan-300/12 bg-black/18 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="truncate text-xs font-semibold text-cyan-50">{port?.label ?? binding.targetInputPortId}</div>
        <select
          className="rounded-md border border-white/10 bg-black/25 px-1 py-1 text-[11px] text-cyan-50 outline-none"
          onChange={(event) => updateBinding((draft) => {
            draft.source = createSourceForMode(event.target.value as FunctionBindingSource['mode']);
          })}
          value={source.mode}
        >
          <option value="flow">Flow</option>
          <option value="constant">Constant</option>
          <option value="expression">Expression</option>
        </select>
      </div>
      {source.mode === 'flow' ? (
        <div className="grid grid-cols-2 gap-1">
          <input
            className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-cyan-50 outline-none"
            onChange={(event) => updateBinding((draft) => {
              if (draft.source.mode === 'flow') draft.source.sourceVariable = event.target.value;
            })}
            placeholder="variable"
            value={source.sourceVariable ?? ''}
          />
          <input
            className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-cyan-50 outline-none"
            onChange={(event) => updateBinding((draft) => {
              if (draft.source.mode === 'flow') draft.source.sourceHandle = event.target.value;
            })}
            placeholder="handle"
            value={source.sourceHandle ?? ''}
          />
        </div>
      ) : null}
      {source.mode === 'constant' ? (
        <div className="grid grid-cols-[96px_1fr] gap-1">
          <select
            className="rounded-md border border-white/10 bg-black/25 px-1 py-1 text-xs text-cyan-50 outline-none"
            onChange={(event) => updateBinding((draft) => {
              if (draft.source.mode === 'constant') draft.source.valueType = event.target.value as typeof CONSTANT_TYPES[number];
            })}
            value={source.valueType}
          >
            {CONSTANT_TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
          <input
            className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-cyan-50 outline-none"
            onChange={(event) => updateBinding((draft) => {
              if (draft.source.mode === 'constant') draft.source.value = parseConstantValue(event.target.value, draft.source.valueType);
            })}
            value={String(source.value ?? '')}
          />
        </div>
      ) : null}
      {source.mode === 'expression' ? (
        <div className="space-y-1">
          <select
            className="w-full rounded-md border border-white/10 bg-black/25 px-1 py-1 text-xs text-cyan-50 outline-none"
            onChange={(event) => updateBinding((draft) => {
              if (draft.source.mode === 'expression') draft.source.language = event.target.value as typeof draft.source.language;
            })}
            value={source.language}
          >
            <option value="mustache">mustache</option>
            <option value="jsonata">jsonata</option>
            <option value="javascript">javascript</option>
          </select>
          <textarea
            className="h-16 w-full resize-none rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-cyan-50 outline-none"
            onChange={(event) => updateBinding((draft) => {
              if (draft.source.mode === 'expression') draft.source.expression = event.target.value;
            })}
            value={source.expression}
          />
        </div>
      ) : null}
      <TransformEditor transforms={binding.transforms} updateTransforms={(transforms) => updateBinding((draft) => { draft.transforms = transforms; })} />
    </div>
  );
}

function OutputBindingsEditor({
  config,
  updateConfig,
}: {
  config: FunctionNodeConfig;
  updateConfig: (recipe: (draft: FunctionNodeConfig) => void) => void;
}) {
  return (
    <div className={withFlowNodeInteractionClasses('space-y-2')}>
      {config.outputBindings.map((binding) => {
        const port = config.contract.outputPorts.find((entry) => entry.id === binding.targetOutputPortId);
        return (
          <div className="rounded-lg border border-emerald-300/12 bg-black/18 p-2" key={binding.id}>
            <div className="mb-2 text-xs font-semibold text-emerald-50">{port?.label ?? binding.targetOutputPortId}</div>
            <div className="grid grid-cols-[1fr_90px] gap-1">
              <select
                className="rounded-md border border-white/10 bg-black/25 px-1 py-1 text-xs text-cyan-50 outline-none"
                onChange={(event) => updateConfig((draft) => {
                  const next = draft.outputBindings.find((entry) => entry.id === binding.id);
                  if (next) next.sourceNodeId = event.target.value;
                })}
                value={binding.sourceNodeId}
              >
                <option value="">No source</option>
                {config.graph.nodes.map((node) => (
                  <option key={node.id} value={node.id}>{node.data.customTitle as string || node.id}</option>
                ))}
              </select>
              <select
                className="rounded-md border border-white/10 bg-black/25 px-1 py-1 text-xs text-cyan-50 outline-none"
                onChange={(event) => updateConfig((draft) => {
                  const next = draft.outputBindings.find((entry) => entry.id === binding.id);
                  if (next) next.resultType = event.target.value as FunctionValueKind;
                })}
                value={binding.resultType}
              >
                {RESULT_TYPES.map((type) => <option key={type}>{type}</option>)}
              </select>
            </div>
            <textarea
              className="mt-1 h-14 w-full resize-none rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-cyan-50 outline-none"
              onChange={(event) => updateConfig((draft) => {
                const next = draft.outputBindings.find((entry) => entry.id === binding.id);
                if (next) next.expression = event.target.value;
              })}
              placeholder="{{flow.input.prompt}}"
              value={binding.expression ?? ''}
            />
            <TransformEditor
              transforms={binding.transforms}
              updateTransforms={(transforms) => updateConfig((draft) => {
                const next = draft.outputBindings.find((entry) => entry.id === binding.id);
                if (next) next.transforms = transforms;
              })}
            />
          </div>
        );
      })}
    </div>
  );
}

function TransformEditor({
  transforms,
  updateTransforms,
}: {
  transforms: FunctionTransformStep[];
  updateTransforms: (transforms: FunctionTransformStep[]) => void;
}) {
  const addTransform = () => {
    updateTransforms([...transforms, { id: `transform-${Date.now()}`, kind: 'trim' }]);
  };

  return (
    <div className="mt-2 rounded-md border border-white/8 bg-white/[0.03] p-2">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-100/45">
          <ListPlus size={12} /> Transform
        </div>
        <button className="rounded border border-cyan-300/15 p-1 text-cyan-100 hover:border-cyan-200/50" onClick={addTransform} type="button">
          <Plus size={12} />
        </button>
      </div>
      <div className="space-y-1">
        {transforms.map((transform, index) => (
          <div className="grid grid-cols-[105px_1fr_22px] gap-1" key={transform.id}>
            <select
              className="rounded-md border border-white/10 bg-black/25 px-1 py-1 text-[11px] text-cyan-50 outline-none"
              onChange={(event) => updateTransforms(transforms.map((entry, entryIndex) => entryIndex === index ? { ...entry, kind: event.target.value as TransformKind } : entry))}
              value={transform.kind}
            >
              {TRANSFORM_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
            <input
              className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-cyan-50 outline-none"
              onChange={(event) => updateTransforms(transforms.map((entry, entryIndex) => entryIndex === index ? transformWithParam(entry, event.target.value) : entry))}
              placeholder="value / path / pattern"
              value={transformParamValue(transform)}
            />
            <button className="rounded text-cyan-100/50 hover:bg-red-400/10 hover:text-red-100" onClick={() => updateTransforms(transforms.filter((_, entryIndex) => entryIndex !== index))} type="button">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function GraphInspector({ config, warnings }: { config: FunctionNodeConfig; warnings: string[] }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <GraphStat icon={GitBranch} label="Nodes" value={config.graph.nodes.length} />
        <GraphStat icon={Braces} label="Edges" value={config.graph.edges.length} />
      </div>
      <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2">
        {config.graph.nodes.length ? config.graph.nodes.map((node) => (
          <div className="flex items-center justify-between gap-2 rounded bg-white/[0.04] px-2 py-1 text-[11px]" key={node.id}>
            <span className="truncate text-cyan-50">{node.data.customTitle as string || node.id}</span>
            <span className="text-cyan-100/40">{String(node.type)}</span>
          </div>
        )) : <div className="text-xs text-cyan-100/45">No internal graph yet.</div>}
      </div>
      {warnings.length ? (
        <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-2 text-[11px] leading-5 text-amber-100">
          {warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      ) : null}
    </div>
  );
}

function GraphStat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/18 p-2">
      <div className="flex items-center gap-2 text-cyan-100/55"><Icon size={13} /> {label}</div>
      <div className="mt-1 text-lg font-semibold text-cyan-50">{value}</div>
    </div>
  );
}

function cloneConfig(config: FunctionNodeConfig): FunctionNodeConfig {
  return JSON.parse(JSON.stringify(config)) as FunctionNodeConfig;
}

function createPort(kind: 'input' | 'output', order: number): FunctionPortKind {
  const id = `${kind}-${Date.now()}-${order}`;
  return {
    id,
    key: `${kind}_${order + 1}`,
    label: `${kind === 'input' ? 'Input' : 'Output'} ${order + 1}`,
    resultType: 'any',
    required: false,
    order,
  };
}

function createInputBinding(port: FunctionPortKind): FunctionInputBinding {
  return {
    id: `binding-${port.id}`,
    targetInputPortId: port.id,
    source: { mode: 'flow', sourceType: 'nodeOutput' },
    transforms: [],
    resultType: port.resultType,
    missing: { strategy: 'default', value: port.defaultValue ?? '' },
  };
}

function createOutputBinding(port: FunctionPortKind): FunctionOutputBinding {
  return {
    id: `binding-${port.id}`,
    targetOutputPortId: port.id,
    sourceNodeId: '',
    transforms: [],
    resultType: port.resultType,
    missing: { strategy: 'default', value: port.defaultValue ?? '' },
  };
}

function createSourceForMode(mode: FunctionBindingSource['mode']): FunctionBindingSource {
  if (mode === 'constant') {
    return { mode, valueType: 'string', value: '' };
  }
  if (mode === 'expression') {
    return { mode, language: 'mustache', expression: '{{flow.input.value}}' };
  }
  return { mode, sourceType: 'nodeOutput' };
}

function parseConstantValue(value: string, valueType: string): DynamicValue {
  if (valueType === 'number') return Number(value) || 0;
  if (valueType === 'boolean') return value === 'true';
  if (valueType === 'null') return null;
  if (valueType === 'json') {
    try {
      return JSON.parse(value) as DynamicValue;
    } catch {
      return {};
    }
  }
  return value;
}

function transformParamValue(transform: FunctionTransformStep): string {
  const record = transform as unknown as Record<string, unknown>;
  return String(record.text ?? record.value ?? record.find ?? record.pattern ?? record.path ?? record.template ?? record.count ?? record.fallback ?? record.sourcePath ?? record.when ?? '');
}

function transformWithParam(transform: FunctionTransformStep, value: string): FunctionTransformStep {
  switch (transform.kind) {
    case 'defaultValue':
      return { ...transform, value };
    case 'prefix':
    case 'suffix':
    case 'prepend':
    case 'append':
    case 'split':
    case 'join':
      return { ...transform, text: value };
    case 'replace':
      return { ...transform, find: value, replacement: '' };
    case 'regexReplace':
      return { ...transform, pattern: value, replacement: '' };
    case 'jsonPath':
    case 'pick':
      return { ...transform, path: value };
    case 'ifEmpty':
      return { ...transform, fallback: value };
    case 'template':
      return { ...transform, template: value };
    case 'take':
    case 'drop':
      return { ...transform, count: Number(value) || 0 };
    case 'set':
      return { ...transform, sourcePath: value };
    case 'case':
      return { ...transform, when: value as 'lower' };
    default:
      return transform;
  }
}
