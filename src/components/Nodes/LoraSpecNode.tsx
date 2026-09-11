import { memo } from 'react';
import { Layers, Plus, X } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import {
  DEFAULT_LORA_SCALE,
  MAX_LORA_ENTRIES,
  MAX_LORA_SCALE,
  MIN_LORA_SCALE,
  buildLoraWeightsJson,
  clampLoraScale,
  normalizeLoraEntries,
  type LoraEntry,
} from '../../lib/loraSpecNode';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

// Builds the `loras` JSON ([{ path, scale }], max 3) that FLUX LoRA image models accept. Connect this
// node to a FLUX LoRA image node (flux-kontext-dev-lora / flux-dev-lora) to feed it for consistency.
function LoraSpecNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const entries = normalizeLoraEntries(data.loraEntries);
  const json = buildLoraWeightsJson(entries);

  const setEntries = (next: LoraEntry[]) => patchNodeData(id, { loraEntries: next });
  const updateEntry = (index: number, patch: Partial<LoraEntry>) =>
    setEntries(entries.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry)));
  const addEntry = () => {
    if (entries.length < MAX_LORA_ENTRIES) {
      setEntries([...entries, { path: '', scale: DEFAULT_LORA_SCALE }]);
    }
  };
  const removeEntry = (index: number) => setEntries(entries.filter((_, entryIndex) => entryIndex !== index));

  return (
    <BaseNode
      nodeId={id}
      nodeType="loraSpecNode"
      icon={Layers}
      title="LoRA Spec"
      hasInput={false}
      hasOutput
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="space-y-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs">
        <div className="space-y-2">
          {entries.map((entry, index) => (
            <div className="space-y-1 rounded-md border border-gray-700/70 bg-gray-950 p-2" key={index}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-gray-400">#{index + 1}</span>
                <input
                  className={withFlowNodeInteractionClasses('min-w-0 flex-1 rounded border border-gray-700 bg-[#070a10] px-2 py-1 text-gray-100 outline-none placeholder:text-gray-500 focus:border-amber-300')}
                  onChange={(event) => updateEntry(index, { path: event.target.value })}
                  placeholder="LoRA URL or path"
                  value={entry.path}
                />
                <button
                  aria-label={`Remove LoRA ${index + 1}`}
                  className={withFlowNodeInteractionClasses('flex h-6 w-6 shrink-0 items-center justify-center rounded border border-gray-700 bg-gray-950 text-gray-300 transition-colors hover:border-red-400/50 hover:text-red-200')}
                  onClick={() => removeEntry(index)}
                  title="Remove LoRA"
                  type="button"
                >
                  <X size={12} />
                </button>
              </div>
              <label className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400">Scale</span>
                <input
                  className={withFlowNodeInteractionClasses('min-w-0 flex-1 accent-amber-400')}
                  max={MAX_LORA_SCALE}
                  min={MIN_LORA_SCALE}
                  onChange={(event) => updateEntry(index, { scale: clampLoraScale(Number(event.target.value)) })}
                  step={0.05}
                  type="range"
                  value={entry.scale}
                />
                <input
                  className={withFlowNodeInteractionClasses('w-14 rounded border border-gray-700 bg-[#070a10] px-1 py-0.5 text-right font-mono text-[11px] text-gray-100')}
                  max={MAX_LORA_SCALE}
                  min={MIN_LORA_SCALE}
                  onChange={(event) => updateEntry(index, { scale: clampLoraScale(Number(event.target.value)) })}
                  step={0.05}
                  type="number"
                  value={entry.scale}
                />
              </label>
            </div>
          ))}
          {entries.length < MAX_LORA_ENTRIES && (
            <button
              className={withFlowNodeInteractionClasses('flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-amber-400/50 bg-amber-400/10 px-2 py-1.5 font-semibold text-amber-100 transition-colors hover:bg-amber-400/20')}
              onClick={addEntry}
              type="button"
            >
              <Plus size={14} /> Add LoRA
            </button>
          )}
          {entries.length === 0 && (
            <p className="text-[10px] text-gray-500">Add a LoRA URL/path + scale (0&ndash;4), then connect this node to a FLUX LoRA image model.</p>
          )}
        </div>

        <div className="rounded-md border border-gray-700/70 bg-gray-950 p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">loras JSON</div>
          <code className="block max-h-24 overflow-y-auto whitespace-pre-wrap break-all text-[10px] leading-4 text-gray-300">
            {json || 'Add a LoRA with a path to output JSON.'}
          </code>
        </div>
      </div>
    </BaseNode>
  );
}

export const LoraSpecNode = memo(LoraSpecNodeComponent);
