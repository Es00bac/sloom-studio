import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { DoodleCanvasDialog } from './DoodleCanvasDialog';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { ASPECT_RATIO_OPTIONS } from '../../lib/providerCatalog';
import { DEFAULT_DOODLE_ASPECT_RATIO } from '../../lib/doodleNode';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps, AspectRatio } from '../../types/flow';

function DoodleNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const hasUpstreamText = useFlowStore((state) => state.edges.some((edge) => edge.target === id));
  const [editorOpen, setEditorOpen] = useState(false);

  const aspectRatio = (data.aspectRatio as AspectRatio | undefined) ?? DEFAULT_DOODLE_ASPECT_RATIO;
  const description = typeof data.doodleDescription === 'string' ? data.doodleDescription : '';
  const sketch = typeof data.doodleSketch === 'string' ? data.doodleSketch : undefined;

  return (
    <BaseNode
      nodeId={id}
      nodeType="doodleNode"
      icon={Pencil}
      title="Doodle"
      hasInput
      hasOutput
      error={data.error}
      statusMessage={data.statusMessage}
    >
      <div className="space-y-3 rounded-lg border border-sky-400/20 bg-sky-400/5 p-3 text-xs">
        <button
          className={withFlowNodeInteractionClasses('group relative flex w-full items-center justify-center overflow-hidden rounded-md border border-gray-700 bg-gray-950')}
          onClick={() => setEditorOpen(true)}
          style={{ aspectRatio: aspectRatio.replace(':', ' / ') }}
          title="Open the drawing canvas"
          type="button"
        >
          {sketch ? (
            <img alt="Doodle sketch" className="h-full w-full object-contain" src={sketch} />
          ) : (
            <span className="flex flex-col items-center gap-1 text-gray-500">
              <Pencil size={20} className="text-sky-400/70" />
              Tap to sketch
            </span>
          )}
        </button>

        <label className="block">
          <span className="mb-1 block font-semibold text-gray-200">Aspect ratio</span>
          <select
            className={withFlowNodeInteractionClasses('w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-100 outline-none focus:border-sky-300')}
            onChange={(event) => patchNodeData(id, { aspectRatio: event.target.value as AspectRatio })}
            value={aspectRatio}
          >
            {ASPECT_RATIO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block font-semibold text-gray-200">Description</span>
          {hasUpstreamText ? (
            <p className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-400">
              Using the attached Text node for the description.
            </p>
          ) : (
            <textarea
              className={withFlowNodeInteractionClasses('w-full resize-y rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-100 outline-none focus:border-sky-300')}
              onChange={(event) => patchNodeData(id, { doodleDescription: event.target.value })}
              placeholder="Describe the sketch for the Image node…"
              rows={2}
              value={description}
            />
          )}
        </label>
      </div>

      <DoodleCanvasDialog
        open={editorOpen}
        aspectRatio={aspectRatio}
        initialSketch={sketch}
        onClose={() => setEditorOpen(false)}
        onSave={(dataUrl) => patchNodeData(id, { doodleSketch: dataUrl })}
      />
    </BaseNode>
  );
}

export const DoodleNode = DoodleNodeComponent;
