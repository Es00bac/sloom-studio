import { memo, useEffect } from 'react';
import { Position, useUpdateNodeInternals } from '@xyflow/react';
import { Palette, Plus, X } from 'lucide-react';
import { AdvancedColorPicker } from '../Common/AdvancedColorPicker';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import {
  COLOR_SWATCH_USAGE_OPTIONS,
  DEFAULT_COLOR_SWATCH_DRAFT_COLOR,
  formatColorSwatchPrompt,
  normalizeColorSwatchColors,
  normalizeHexColor,
  paletteColorHandleId,
  resolveColorSwatchUsageMode,
} from '../../lib/colorSwatchNode';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps, ColorSwatchUsageMode } from '../../types/flow';

// Returns a color not already in the palette so each "+" adds a fresh, editable chip (palette colors are
// de-duplicated, so appending a duplicate would silently no-op).
function nextUniqueColor(colors: string[]): string {
  if (!colors.includes(DEFAULT_COLOR_SWATCH_DRAFT_COLOR)) {
    return DEFAULT_COLOR_SWATCH_DRAFT_COLOR;
  }
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
    if (!colors.includes(candidate)) {
      return candidate;
    }
  }
  return DEFAULT_COLOR_SWATCH_DRAFT_COLOR;
}

// NOTE: the node type id stays `colorSwatchNode` for back-compat with saved projects (no node-type
// migration exists); this node is now the master "Color Palette". The labelled subset lives in the
// separate Color Swatch node.
function ColorPaletteNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const updateNodeInternals = useUpdateNodeInternals();
  const colors = normalizeColorSwatchColors(data.colorSwatchColors);
  // React Flow caches each node's handle positions; color chips (and their source handles) added AFTER
  // the node was first measured stay unconnectable (the "only the first N colors give an edge" bug) until
  // we ask it to re-measure. Re-measure on mount and whenever the color count changes so every color's
  // handle is draggable.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, colors.length, updateNodeInternals]);
  const usageMode = resolveColorSwatchUsageMode(data.colorSwatchUsageMode);
  const promptText = formatColorSwatchPrompt({
    colorSwatchColors: colors,
    colorSwatchUsageMode: usageMode,
  });

  const setColors = (nextColors: string[]) => patchNodeData(id, { colorSwatchColors: nextColors });
  const updateColor = (index: number, value: string) => {
    const nextColor = normalizeHexColor(value);
    if (!nextColor) return;
    setColors(colors.map((color, colorIndex) => (colorIndex === index ? nextColor : color)));
  };
  const addColor = () => setColors([...colors, nextUniqueColor(colors)]);
  const removeColor = (index: number) => setColors(colors.filter((_, colorIndex) => colorIndex !== index));

  return (
    <BaseNode
      nodeId={id}
      nodeType="colorSwatchNode"
      icon={Palette}
      title="Color Palette"
      hasInput={false}
      hasOutput
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="space-y-3 rounded-lg border border-pink-400/20 bg-pink-400/5 p-3 text-xs">
        <div>
          <span className="mb-1.5 block font-semibold text-gray-200">Colors</span>
          <div className="flex flex-wrap items-start gap-2">
            {colors.map((color, index) => (
              <div className="group relative flex flex-col items-center" key={`${color}-${index}`}>
                <AdvancedColorPicker
                  buttonClassName={withFlowNodeInteractionClasses('rounded-md border border-black/45 transition-transform hover:scale-105')}
                  className="h-9 w-9"
                  label={`Edit color ${index + 1}`}
                  onChange={(value) => updateColor(index, value)}
                  value={color}
                />
                {/* Per-color source handle — drag to a Color Swatch node to label this color per scene. */}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={paletteColorHandleId(index)}
                  className="!h-2.5 !w-2.5 !min-w-0 !border !border-pink-100 !bg-pink-400"
                  style={{ top: 18, right: -7 }}
                  title={`Connect ${color} to a Color Swatch`}
                />
                <button
                  aria-label={`Remove color ${index + 1}`}
                  className={withFlowNodeInteractionClasses('absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border border-gray-700 bg-gray-950 text-gray-300 transition-colors hover:text-red-200 group-hover:flex')}
                  onClick={() => removeColor(index)}
                  title="Remove color"
                  type="button"
                >
                  <X size={10} />
                </button>
                <code className="mt-0.5 block text-center font-mono text-[9px] text-gray-400">{color}</code>
              </div>
            ))}
            <button
              className={withFlowNodeInteractionClasses('flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-pink-400/50 bg-pink-400/10 text-pink-100 transition-colors hover:bg-pink-400/20')}
              onClick={addColor}
              title="Add color"
              type="button"
            >
              <Plus size={16} />
            </button>
          </div>
          {colors.length === 0 && (
            <p className="mt-1.5 text-[10px] text-gray-500">Click + to add your first color, then click a chip to set its hex.</p>
          )}
        </div>

        <label className="block">
          <span className="mb-1.5 block font-semibold text-gray-200">Usage</span>
          <select
            className={withFlowNodeInteractionClasses('w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-100 outline-none focus:border-pink-300')}
            onChange={(event) => patchNodeData(id, {
              colorSwatchUsageMode: event.target.value as ColorSwatchUsageMode,
            })}
            value={usageMode}
          >
            {COLOR_SWATCH_USAGE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>

        <div className="rounded-md border border-gray-700/70 bg-gray-950 p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Output</div>
          <p className="max-h-24 overflow-y-auto text-[10px] leading-4 text-gray-300">
            {promptText || 'Add colors to output palette guidance.'}
          </p>
        </div>
      </div>
    </BaseNode>
  );
}

export const ColorSwatchNode = memo(ColorPaletteNodeComponent);
