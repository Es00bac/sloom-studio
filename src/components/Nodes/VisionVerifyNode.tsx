import { memo, useMemo } from 'react';
import { Position } from '@xyflow/react';
import { Eye, CheckCircle2, XCircle } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';
import { resultValueAsMediaUrl, restoreResultValue } from '../../lib/flowResultValues';

function VisionVerifyNodeComponent({ id, data }: AppNodeProps) {
  const runNode = useFlowStore((state) => state.runNode);
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const result = restoreResultValue(data.result, 'boolean');
  const explanation = data.usage?.notes?.[0] as string | undefined;

  const handleRun = () => {
    void runNode(id);
  };

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    patchNodeData(id, { modelId: event.target.value });
  };

  const refImageConnected = useMemo(() => {
    const indexEdge = edges.find((edge) => edge.target === id && edge.targetHandle === 'refImage');
    if (!indexEdge) return undefined;
    const rawSource = nodes.find((n) => n.id === indexEdge.source);
    if (!rawSource) return undefined;
    return rawSource.type === 'imageGen'
      ? resultValueAsMediaUrl(rawSource.data.mediaMode === 'import' ? rawSource.data.sourceAssetUrl : rawSource.data.result)
      : undefined;
  }, [id, nodes, edges]);

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1 pb-1">
        <span className="text-[8px] font-bold text-gray-500 ml-2">SUBJECT</span>
        <span className="text-[8px] font-bold text-gray-500 ml-2">REF (IMG)</span>
        <span className="text-[8px] font-bold text-gray-500 ml-2">PROMPT</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: '25%', background: '#2dd4bf', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="refImage"
        style={{ top: '55%', background: '#eab308', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: '80%', background: '#a78bfa', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="visionVerifyNode"
      icon={Eye}
      title="Vision Verify"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      onRun={handleRun}
      isRunning={data.isRunning}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Gemini Model:</label>
          <select
            value={data.modelId as string || 'gemini-3.5-flash'}
            onChange={handleModelChange}
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-100 focus:border-purple-400 focus:outline-none"
          >
            <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
          </select>
        </div>

        {refImageConnected && (
          <div className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-950 p-2 mt-1">
            <div className="h-8 w-8 rounded border border-gray-700 overflow-hidden flex items-center justify-center bg-gray-900 shrink-0">
              <img src={refImageConnected} alt="Reference Preview" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1 flex flex-col">
              <span className="font-bold text-[9px] text-amber-400 uppercase tracking-wider">Side-By-Side Mode</span>
              <span className="text-[8px] text-gray-400 truncate mt-0.5">Reference design connected</span>
            </div>
          </div>
        )}

        {typeof result === 'boolean' && (
          <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-gray-700 bg-gray-900/60 p-2">
            <div className="flex items-center gap-1.5 font-bold">
              {result === true ? (
                <>
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  <span className="text-emerald-400 uppercase">Passed (Consistent)</span>
                </>
              ) : (
                <>
                  <XCircle size={14} className="text-rose-400" />
                  <span className="text-rose-400 uppercase">Failed (Inconsistent)</span>
                </>
              )}
            </div>
            {explanation && (
              <div className="text-[10px] leading-4 text-gray-300 italic">
                "{explanation}"
              </div>
            )}
          </div>
        )}

        <div className="mt-1 leading-5 text-gray-500 text-[10px]">
          Compares the input image against the prompt description and outputs the Boolean <span className="text-emerald-400 font-bold">true</span> or <span className="text-rose-400 font-bold">false</span> for downstream logic.
        </div>
      </div>
    </BaseNode>
  );
}

export const VisionVerifyNode = memo(VisionVerifyNodeComponent);
