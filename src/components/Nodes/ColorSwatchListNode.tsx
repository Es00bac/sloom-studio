import { memo } from 'react';
import { Tags, X } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import {
  formatColorSwatchListPrompt,
  resolveColorSwatchListEntries,
} from '../../lib/colorSwatchNode';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

// The Color Swatch node is a labelled SUBSET of one or more Color Palettes: drag a palette color handle
// here and it becomes a `{ live color, editable label }` row. Colors resolve live from the source palette,
// so editing the palette updates the swatch; removing a row just disconnects that color.
function ColorSwatchListNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const onEdgesChange = useFlowStore((state) => state.onEdgesChange);

  const node = { id, data };
  const entries = resolveColorSwatchListEntries(node, nodes, edges);
  const promptText = formatColorSwatchListPrompt(node, nodes, edges);

  const setLabel = (key: string, label: string) => {
    patchNodeData(id, {
      colorSwatchEntryLabels: { ...(data.colorSwatchEntryLabels ?? {}), [key]: label },
    });
  };
  const removeEntry = (key: string) => {
    const edge = edges.find(
      (candidate) => candidate.target === id && `${candidate.source}:${candidate.sourceHandle ?? ''}` === key,
    );
    if (edge) {
      onEdgesChange([{ id: edge.id, type: 'remove' }]);
    }
  };

  return (
    <BaseNode
      nodeId={id}
      nodeType="colorSwatchListNode"
      icon={Tags}
      title="Color Swatch"
      hasInput
      hasOutput
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="space-y-3 rounded-lg border border-violet-400/20 bg-violet-400/5 p-3 text-xs">
        <div className="space-y-2">
          {entries.length > 0 ? entries.map((entry) => (
            <div className="flex items-center gap-2" key={entry.key}>
              <span
                className="h-7 w-7 shrink-0 rounded-md border border-black/45"
                style={{ backgroundColor: entry.color }}
                title={entry.color}
              />
              <input
                className={withFlowNodeInteractionClasses('min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-100 outline-none placeholder:text-gray-500 focus:border-violet-300')}
                onChange={(event) => setLabel(entry.key, event.target.value)}
                placeholder="Describe (e.g. hair, skin, shirt)"
                value={entry.label}
              />
              <code className="shrink-0 font-mono text-[10px] text-gray-400">{entry.color}</code>
              <button
                aria-label="Remove swatch entry"
                className={withFlowNodeInteractionClasses('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-gray-700 bg-gray-950 text-gray-300 transition-colors hover:border-red-400/50 hover:text-red-200')}
                onClick={() => removeEntry(entry.key)}
                title="Remove (disconnects this color)"
                type="button"
              >
                <X size={12} />
              </button>
            </div>
          )) : (
            <div className="rounded-md border border-dashed border-gray-700 bg-gray-950 px-2 py-3 text-center text-[10px] text-gray-500">
              Drag colors from a Color Palette&rsquo;s handles into this node to build a labeled swatch (a subset of the palette).
            </div>
          )}
        </div>

        <div className="rounded-md border border-gray-700/70 bg-gray-950 p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Output</div>
          <p className="max-h-24 overflow-y-auto text-[10px] leading-4 text-gray-300">
            {promptText || 'Connect colors from a Color Palette to output swatch guidance.'}
          </p>
        </div>
      </div>
    </BaseNode>
  );
}

export const ColorSwatchListNode = memo(ColorSwatchListNodeComponent);
