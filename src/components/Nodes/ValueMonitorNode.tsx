import { memo, useMemo } from 'react';
import { Activity } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { useFlowStore, evaluateNodeTextForMonitor } from '../../store/flowStore';
import { resolveEffectiveSourceNode } from '../../lib/virtualNodes';
import { resolveExpandedListItemForNode, collectEnvelopeItemsFromSourceNode } from '../../lib/listNodes';
import { evaluateNodeSignal, signalToTextList } from '../../lib/flowSignals';
import type { AppNodeProps, EnvelopeItem } from '../../types/flow';

function ValueMonitorNodeComponent({ id, data }: AppNodeProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);

  const monitorValue = useMemo(() => {
    const incomingEdge = edges.find((edge) => edge.target === id);
    if (!incomingEdge) {
      return { type: 'disconnected', text: 'Disconnected' };
    }

    const nodesById = new Map(nodes.map((n) => [n.id, n]));
    const rawSourceNode = nodesById.get(incomingEdge.source);
    if (!rawSourceNode) {
      return { type: 'disconnected', text: 'Disconnected' };
    }

    const sourceNode = resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, incomingEdge.sourceHandle);
    if (!sourceNode) {
      return { type: 'disconnected', text: 'Disconnected' };
    }

    // 1. Is it an expander?
    if (sourceNode.type === 'expander') {
      const item = resolveExpandedListItemForNode(sourceNode, nodes, edges);
      if (item) {
        if (item.kind === 'image' && item.value) {
          return { type: 'image', image: item.value, text: item.label || 'Expanded Image' };
        }
        if (item.kind === 'video' && item.value) {
          return { type: 'video', video: item.value, text: item.label || 'Expanded Video' };
        }
        if (item.kind === 'audio' && item.value) {
          return { type: 'audio', audio: item.value, text: item.label || 'Expanded Audio' };
        }
        if (item.kind === 'package') {
          return { type: 'package', image: item.value, text: item.text || item.label || 'Expanded Package' };
        }
        if (item.kind === 'number') {
          return { type: 'number', text: item.value || '0' };
        }
        if (item.value) {
          const lower = item.value.toLowerCase().trim();
          if (lower === 'true') return { type: 'boolean-true', text: 'TRUE' };
          if (lower === 'false') return { type: 'boolean-false', text: 'FALSE' };
          if (item.value.trim() !== '' && !isNaN(Number(item.value.trim()))) {
            return { type: 'number', text: item.value };
          }
          return { type: 'string', text: item.value };
        }
      }
    }

    // 2. Is it a direct packageNode?
    if (sourceNode.type === 'packageNode') {
      const matchingEdges = edges.filter((edge) => edge.target === sourceNode.id);
      let pkgText = '';
      let pkgImage: string | undefined;
      for (const edge of matchingEdges) {
        const rawSrc = nodes.find((n) => n.id === edge.source);
        if (!rawSrc) continue;
        const resolvedSrc = resolveEffectiveSourceNode(rawSrc, nodesById, edges, edge.sourceHandle);
        if (!resolvedSrc) continue;

        if (edge.targetHandle === 'text' || !edge.targetHandle) {
          if (resolvedSrc.type === 'textNode') {
            const m = resolvedSrc.data.mode ?? 'prompt';
            pkgText += ((m === 'generate' ? resolvedSrc.data.result : resolvedSrc.data.prompt) as string | undefined) || '';
          } else if (resolvedSrc.type === 'expander') {
            const item = resolveExpandedListItemForNode(resolvedSrc, nodes, edges);
            if (item?.kind === 'text' && item.value?.trim()) {
              pkgText += item.value.trim();
            }
          } else {
            const evaluated = evaluateNodeTextForMonitor(resolvedSrc.id, nodes, edges);
            if (evaluated.trim()) {
              pkgText += evaluated.trim();
            }
          }
        } else if (edge.targetHandle === 'image') {
          if (resolvedSrc.type === 'imageGen' || resolvedSrc.type === 'cropImageNode') {
            pkgImage = (resolvedSrc.data.mediaMode === 'import' ? resolvedSrc.data.sourceAssetUrl : resolvedSrc.data.result) as string | undefined;
          } else if (resolvedSrc.type === 'expander') {
            const item = resolveExpandedListItemForNode(resolvedSrc, nodes, edges);
            if (item?.kind === 'image' && item.value) {
              pkgImage = item.value;
            }
          }
        }
      }
      return { type: 'package', image: pkgImage, text: pkgText.trim() || 'Asset Package' };
    }

    // 3. Is it an image output?
    if (sourceNode.type === 'imageGen' || sourceNode.type === 'cropImageNode') {
      const img = sourceNode.data.mediaMode === 'import' ? sourceNode.data.sourceAssetUrl : sourceNode.data.result;
      if (img) {
        return { type: 'image', image: img as string, text: sourceNode.data.customTitle || (sourceNode.type === 'cropImageNode' ? 'Cropped Image' : 'Image Gen') };
      }
    }

    // 4. Is it a video output?
    if (sourceNode.type === 'videoGen') {
      const videoUrl = sourceNode.data.mediaMode === 'import' ? sourceNode.data.sourceAssetUrl : sourceNode.data.result;
      if (videoUrl) {
        return { type: 'video', video: videoUrl as string, text: sourceNode.data.customTitle || 'Video Gen' };
      }
    }

    // 5. Is it a composition output?
    if (sourceNode.type === 'composition') {
      const videoUrl = sourceNode.data.result;
      if (videoUrl) {
        return { type: 'video', video: videoUrl as string, text: sourceNode.data.customTitle || 'Composition' };
      }
    }

    // 6. Is it an audio output?
    if (sourceNode.type === 'audioGen') {
      const audioUrl = sourceNode.data.mediaMode === 'import' ? sourceNode.data.sourceAssetUrl : sourceNode.data.result;
      if (audioUrl) {
        return { type: 'audio', audio: audioUrl as string, text: sourceNode.data.customTitle || 'Audio Gen' };
      }
    }

    // 7. Is it a list or envelope node?
    if (sourceNode.type === 'list' || sourceNode.type === 'envelope') {
      const items = collectEnvelopeItemsFromSourceNode(sourceNode, nodes, edges);
      if (items && items.length > 0) {
        return {
          type: 'list',
          items,
          text: sourceNode.data.customTitle || (sourceNode.type === 'list' ? 'List' : 'Envelope'),
        };
      }
    }

    const signal = evaluateNodeSignal(sourceNode.id, nodes, edges);
    if (Array.isArray(signal.items) && signal.items.length > 0) {
      return {
        type: 'list',
        items: signal.items.map((item, idx) => ({
          id: `${sourceNode.id}-signal-${idx}`,
          index: idx,
          kind: item.kind === 'boolean' || item.kind === 'any' ? 'text' : item.kind,
          label: item.label ?? signalToTextList(item)[0] ?? `Item ${idx + 1}`,
          value: signalToTextList(item)[0] ?? '',
          mimeType: item.mimeType ?? 'text/plain',
          sourceNodeId: item.sourceNodeId ?? sourceNode.id,
        })),
        text: sourceNode.data.customTitle || `${sourceNode.type} batch`,
      };
    }

    // 8. Is it a text/logic/comparison/numeric output?
    let textVal = '';
    const SUPPORTED_MONITOR_TYPES = [
      'textNode', 'logicNode', 'comparisonNode', 'visionVerifyNode',
      'listLengthNode', 'mathNode', 'conditionalNode',
      'stringTemplateNode', 'promptsJoinerNode', 'regexReplaceNode', 'numberNode', 'functionNode'
    ];

    if (SUPPORTED_MONITOR_TYPES.includes(sourceNode.type)) {
      textVal = evaluateNodeTextForMonitor(sourceNode.id, nodes, edges);
    }

    if (textVal) {
      const lower = textVal.toLowerCase().trim();
      if (lower === 'true') {
        return { type: 'boolean-true', text: 'TRUE' };
      }
      if (lower === 'false') {
        return { type: 'boolean-false', text: 'FALSE' };
      }

      const trimmed = textVal.trim();
      if (trimmed !== '' && !isNaN(Number(trimmed))) {
        return { type: 'number', text: textVal };
      }
      return { type: 'string', text: textVal };
    }

    return { type: 'empty', text: 'Empty / No Value' };
  }, [id, nodes, edges]);

  return (
    <BaseNode
      nodeId={id}
      nodeType="valueMonitorNode"
      icon={Activity}
      title="Value Monitor"
      hasInput={true}
      hasOutput={true}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs">
        <div className="flex flex-col items-center justify-center rounded-md border border-gray-800 bg-[#0c0e14] p-4 text-center">
          {monitorValue.type === 'disconnected' && (
            <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">
              Disconnected
            </span>
          )}

          {monitorValue.type === 'empty' && (
            <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">
              {monitorValue.text}
            </span>
          )}

          {monitorValue.type === 'boolean-true' && (
            <div className="flex flex-col items-center gap-1">
              <span className="text-xl font-black text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)] uppercase tracking-widest animate-pulse">
                ✓ {monitorValue.text}
              </span>
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mt-1">Logic Passed</span>
            </div>
          )}

          {monitorValue.type === 'boolean-false' && (
            <div className="flex flex-col items-center gap-1">
              <span className="text-xl font-black text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.3)] uppercase tracking-widest">
                ✗ {monitorValue.text}
              </span>
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mt-1">Logic Blocked</span>
            </div>
          )}

          {monitorValue.type === 'number' && (
            <div className="flex flex-col items-center gap-1">
              <span className="text-3xl font-black text-sky-400 drop-shadow-[0_0_10px_rgba(56,189,248,0.25)]">
                {monitorValue.text}
              </span>
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mt-1">Numeric Counter</span>
            </div>
          )}

          {monitorValue.type === 'string' && (
            <div className="flex flex-col items-center w-full">
              <div className="w-full text-left text-[11px] leading-4 text-gray-300 whitespace-pre-wrap max-h-24 overflow-y-auto pr-1 font-sans selection:bg-sky-500/30">
                {monitorValue.text}
              </div>
              <span className="text-[8px] text-gray-500 font-bold uppercase tracking-widest mt-2 self-center border-t border-gray-800/80 pt-1.5 w-full text-center">Text Description</span>
            </div>
          )}

          {monitorValue.type === 'image' && (
            <div className="flex flex-col items-center gap-2">
              <div className="h-16 w-16 rounded-md border border-gray-700 bg-gray-950 overflow-hidden flex items-center justify-center">
                <img src={monitorValue.image} alt="Monitored Output" className="h-full w-full object-cover" />
              </div>
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">{monitorValue.text}</span>
            </div>
          )}

          {monitorValue.type === 'package' && (
            <div className="flex flex-col items-center gap-2 w-full">
              <div className="flex gap-2.5 items-center justify-center w-full">
                {monitorValue.image && (
                  <div className="h-10 w-10 rounded-md border border-gray-700 bg-gray-950 overflow-hidden flex items-center justify-center shrink-0">
                    <img src={monitorValue.image} alt="Package Thumb" className="h-full w-full object-cover" />
                  </div>
                )}
                <div className="min-w-0 text-left text-[10px] leading-4 text-gray-300 whitespace-pre-wrap max-h-16 overflow-y-auto flex-1 font-sans">
                  {monitorValue.text}
                </div>
              </div>
              <span className="text-[8px] text-gray-500 font-bold uppercase tracking-widest mt-1 border-t border-gray-800/80 pt-1.5 w-full text-center">Asset Package</span>
            </div>
          )}

          {monitorValue.type === 'video' && (
            <div className="flex flex-col items-center gap-2 w-full">
              <video src={monitorValue.video} controls className="max-h-28 w-full rounded-md border border-gray-800 bg-black pointer-events-auto" />
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">{monitorValue.text}</span>
            </div>
          )}

          {monitorValue.type === 'audio' && (
            <div className="flex flex-col items-center gap-2 w-full">
              <audio src={monitorValue.audio} controls className="w-full h-8 mt-1 pointer-events-auto" />
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">{monitorValue.text}</span>
            </div>
          )}

          {monitorValue.type === 'list' && (
            <div className="flex flex-col gap-1.5 w-full max-h-36 overflow-y-auto pr-1">
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1 self-start">
                {monitorValue.text} ({monitorValue.items?.length ?? 0} items)
              </div>
              <div className="flex flex-col gap-1 text-left w-full">
                {monitorValue.items?.map((item: EnvelopeItem, idx: number) => (
                  <div key={item.id || idx} className="flex items-center gap-2 rounded bg-gray-900 border border-gray-800 p-1 w-full min-w-0">
                    <span className="text-[9px] font-mono text-sky-500/80 shrink-0 w-4 text-right">
                      {idx}:
                    </span>
                    {item.kind === 'image' && item.value && (
                      <div className="h-6 w-6 rounded border border-gray-700 bg-black overflow-hidden shrink-0 flex items-center justify-center">
                        <img src={item.value} alt="" className="h-full w-full object-cover" />
                      </div>
                    )}
                    {item.kind === 'video' && item.value && (
                      <div className="h-6 w-6 rounded border border-gray-700 bg-black flex items-center justify-center shrink-0">
                        <span className="text-[7px] font-bold text-teal-400">VID</span>
                      </div>
                    )}
                    {item.kind === 'audio' && item.value && (
                      <div className="h-6 w-6 rounded border border-gray-700 bg-black flex items-center justify-center shrink-0">
                        <span className="text-[7px] font-bold text-purple-400">AUD</span>
                      </div>
                    )}
                    <span className="truncate text-[10px] text-gray-300 font-medium flex-1">
                      {item.label || item.value || 'Item'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="mt-1 leading-5 text-gray-500 text-[10px]">
          Displays the live value of any connected variable, description, or image flowing through the flow network in real time.
        </div>
      </div>
    </BaseNode>
  );
}

export const ValueMonitorNode = memo(ValueMonitorNodeComponent);
