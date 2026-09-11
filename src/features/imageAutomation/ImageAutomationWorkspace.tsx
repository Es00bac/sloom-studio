import { useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
} from '@xyflow/react';
import { FileImage, FolderInput, FolderOutput, Layers3, Sparkles, Wand2 } from 'lucide-react';
import {
  IMAGE_AUTOMATION_NODE_TYPES,
  IMAGE_AUTOMATION_NODE_CATALOG_CATEGORIES,
  getImageAutomationNodeEntriesForCategory,
  getImageAutomationNodeEntry,
  type ImageAutomationPortDefinition,
  type ImageAutomationNodeType,
} from './imageAutomationCatalog';
import {
  useImageAutomationStore,
  type ImageAutomationNode,
} from './imageAutomationStore';

const NODE_ICONS: Record<ImageAutomationNodeType, typeof FolderInput> = {
  directoryInput: FolderInput,
  directoryGlobInput: FolderInput,
  imageBatchList: Layers3,
  extractImageMetadata: Sparkles,
  openImage: FileImage,
  resizeCanvas: Layers3,
  applyAdjustment: Wand2,
  applyImageMacro: Wand2,
  aiVariableFillPlan: Sparkles,
  saveOutput: FolderOutput,
  packageOutput: FolderOutput,
};

export function ImageAutomationWorkspace() {
  return (
    <ReactFlowProvider>
      <ImageAutomationWorkspaceInner />
    </ReactFlowProvider>
  );
}

function ImageAutomationWorkspaceInner() {
  const nodes = useImageAutomationStore((state) => state.nodes);
  const edges = useImageAutomationStore((state) => state.edges);
  const addAutomationNode = useImageAutomationStore((state) => state.addAutomationNode);
  const seedStarterFlow = useImageAutomationStore((state) => state.seedStarterFlow);
  const resetAutomationFlow = useImageAutomationStore((state) => state.resetAutomationFlow);
  const onNodesChange = useImageAutomationStore((state) => state.onNodesChange);
  const onEdgesChange = useImageAutomationStore((state) => state.onEdgesChange);
  const onConnect = useImageAutomationStore((state) => state.onConnect);
  const { fitView } = useReactFlow<ImageAutomationNode>();
  const nodeTypes = useMemo(
    () => Object.fromEntries(
      IMAGE_AUTOMATION_NODE_TYPES.map((nodeType) => [nodeType, ImageAutomationFlowNode]),
    ) as Record<ImageAutomationNodeType, typeof ImageAutomationFlowNode>,
    [],
  );

  useEffect(() => {
    if (nodes.length === 0) {
      seedStarterFlow();
    }
  }, [nodes.length, seedStarterFlow]);

  useEffect(() => {
    if (nodes.length > 0) {
      window.requestAnimationFrame(() => {
        fitView({ maxZoom: 0.78, padding: 0.12 });
      });
    }
  }, [fitView, nodes.length]);

  return (
    <section
      className="absolute inset-0 grid min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden bg-[#031613] text-emerald-50"
      data-image-automation-theme="emerald-grid"
      data-image-automation-workspace="true"
    >
      <aside className="min-h-0 overflow-y-auto border-r border-emerald-300/20 bg-[#061c18]/95 p-3 shadow-2xl">
        <header className="mb-3 border-b border-emerald-300/15 pb-3">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-200/80">
            <Sparkles size={14} />
            Image Automation
          </div>
          <p className="mt-2 text-xs leading-5 text-emerald-100/65">
            Separate automation canvas for directory batches, image adjustments, and saved outputs.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              className="rounded-md border border-emerald-300/30 bg-emerald-300/10 px-2 py-1.5 text-[11px] font-semibold text-emerald-50 transition-colors hover:border-emerald-100/70"
              onClick={seedStarterFlow}
              type="button"
            >
              Starter Flow
            </button>
            <button
              className="rounded-md border border-emerald-300/20 bg-black/20 px-2 py-1.5 text-[11px] font-semibold text-emerald-100/75 transition-colors hover:border-emerald-100/60"
              onClick={resetAutomationFlow}
              type="button"
            >
              Clear
            </button>
          </div>
        </header>
        <div className="space-y-3">
          {IMAGE_AUTOMATION_NODE_CATALOG_CATEGORIES.map((category) => (
            <section className="rounded-lg border border-emerald-300/15 bg-black/20 p-2" key={category.id}>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-100/70">{category.label}</div>
              <p className="mt-1 text-[10px] leading-4 text-emerald-100/45">{category.description}</p>
              <div className="mt-2 grid gap-1">
                {getImageAutomationNodeEntriesForCategory(category.id).map((entry, index) => (
                  <button
                    className="rounded-md border border-transparent px-2 py-2 text-left transition-colors hover:border-emerald-300/25 hover:bg-emerald-300/10"
                    key={entry.type}
                    onClick={() => addAutomationNode(entry.type, { x: 160 + index * 48, y: 160 + index * 84 })}
                    type="button"
                  >
                    <span className="block text-xs font-semibold text-emerald-50">{entry.label}</span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-emerald-100/55">{entry.description}</span>
                    {entry.safetyWarnings[0] ? (
                      <span className="mt-1 block text-[10px] leading-4 text-amber-100/70">
                        Safety: {entry.safetyWarnings[0].message}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>
      <div className="relative min-h-0" data-image-automation-canvas="true">
        <div className="pointer-events-none absolute left-5 top-5 z-20 rounded-lg border border-emerald-300/20 bg-[#051512]/85 px-3 py-2 text-xs text-emerald-100/70 shadow-xl">
          <span className="font-semibold text-emerald-50">Image Automation</span>
          <span className="ml-2 text-emerald-100/45">File and batch nodes are isolated from Main Flow.</span>
        </div>
        <ReactFlow<ImageAutomationNode>
          className="bg-[#031613] [background-image:radial-gradient(rgba(52,211,153,0.14)_1px,transparent_1px)] [background-size:22px_22px]"
          edges={edges}
          fitView
          fitViewOptions={{ maxZoom: 0.78, padding: 0.12 }}
          nodeTypes={nodeTypes}
          nodes={nodes}
          onConnect={onConnect}
          onEdgesChange={onEdgesChange}
          onNodesChange={onNodesChange}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(52,211,153,0.22)" gap={28} size={1.4} />
          <Controls className="!bottom-6 !left-5 !border-emerald-300/20 !bg-[#061c18] !text-emerald-100" showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
}

function ImageAutomationFlowNode({ data, type }: NodeProps<ImageAutomationNode>) {
  const nodeType = (type ?? data.automationRole) as ImageAutomationNodeType;
  const entry = getImageAutomationNodeEntry(nodeType);
  const Icon = NODE_ICONS[nodeType] ?? Sparkles;
  const dataSafetyWarnings = Array.isArray(data.safetyWarnings) ? data.safetyWarnings : [];
  const safetyWarnings = dataSafetyWarnings.length > 0 ? dataSafetyWarnings : entry.safetyWarnings;

  return (
    <article className="relative w-64 rounded-lg border border-emerald-300/30 bg-[#071f1b]/95 p-3 text-emerald-50 shadow-2xl">
      {entry.inputs.map((port, index) => (
        <Handle
          className="!h-2.5 !w-2.5 !border-emerald-100 !bg-emerald-300"
          id={port.id}
          key={`input-${port.id}`}
          position={Position.Left}
          style={{ top: `${portOffset(index, entry.inputs.length)}%` }}
          type="target"
        />
      ))}
      <div className="flex items-start gap-2">
        <div className="rounded-md border border-emerald-300/20 bg-emerald-300/10 p-1.5 text-emerald-100">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{data.title}</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-emerald-200/45">{data.categoryId}</div>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-emerald-100/65">{data.summary}</p>
      <div className="mt-3 rounded border border-emerald-300/15 bg-black/20 px-2 py-1.5 text-[10px] text-emerald-100/55">
        Operation: {data.operation}
      </div>
      <ImageAutomationPortList heading="Inputs" ports={entry.inputs} />
      <ImageAutomationPortList heading="Outputs" ports={entry.outputs} />
      {safetyWarnings.length > 0 ? (
        <div className="mt-3 rounded border border-amber-200/20 bg-amber-300/10 px-2 py-1.5 text-[10px] leading-4 text-amber-100/75">
          Safety: {safetyWarnings.map((warning) => warning.message).join(' ')}
        </div>
      ) : null}
      {entry.outputs.map((port, index) => (
        <Handle
          className="!h-2.5 !w-2.5 !border-emerald-100 !bg-emerald-300"
          id={port.id}
          key={`output-${port.id}`}
          position={Position.Right}
          style={{ top: `${portOffset(index, entry.outputs.length)}%` }}
          type="source"
        />
      ))}
    </article>
  );
}

function ImageAutomationPortList({
  heading,
  ports,
}: {
  heading: 'Inputs' | 'Outputs';
  ports: ImageAutomationPortDefinition[];
}) {
  if (ports.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200/50">{heading}</div>
      <div className="mt-1 grid gap-1">
        {ports.map((port) => (
          <div
            className="flex items-center justify-between gap-2 rounded border border-emerald-300/10 bg-black/15 px-2 py-1 text-[10px] text-emerald-100/65"
            key={port.id}
          >
            <span className="truncate font-medium text-emerald-50/85">{port.label}</span>
            <span className="shrink-0 text-emerald-200/45">{port.payload}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function portOffset(index: number, total: number): number {
  if (total <= 1) {
    return 50;
  }
  return 24 + (index * 52) / (total - 1);
}
