import { memo, useState, useMemo } from 'react';
import { Position } from '@xyflow/react';
import { Box, FileText, Image as ImageIcon, Eye, X } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';
import { resultValueAsMediaUrl } from '../../lib/flowResultValues';

function PackageNodeComponent({ id, data }: AppNodeProps) {
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);

  // Dynamically resolve package text and image details
  const pkg = useMemo(() => {
    const matchingEdges = edges.filter((edge) => edge.target === id);
    const textPrompts: string[] = [];
    let imageUrl: string | undefined;

    for (const edge of matchingEdges) {
      const rawSource = nodes.find((n) => n.id === edge.source);
      if (!rawSource) continue;

      if (edge.targetHandle === 'text' || !edge.targetHandle) {
        if (rawSource.type === 'textNode') {
          const mode = rawSource.data.mode ?? 'prompt';
          const value = (mode === 'generate' ? rawSource.data.result : rawSource.data.prompt) as string | undefined;
          if (value?.trim()) {
            textPrompts.push(value.trim());
          }
        }
      } else if (edge.targetHandle === 'image') {
        if (rawSource.type === 'imageGen' || rawSource.type === 'cropImageNode') {
          imageUrl = resultValueAsMediaUrl(rawSource.data.mediaMode === 'import'
            ? rawSource.data.sourceAssetUrl
            : rawSource.data.result);
        }
      }
    }

    return {
      text: textPrompts.join('\n\n').trim(),
      image: imageUrl,
    };
  }, [id, nodes, edges]);

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[9px] font-bold text-gray-500 ml-2">IMAGE</span>
        <span className="text-[9px] font-bold text-gray-500 ml-2">TEXT</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{
          top: '32%',
          background: pkg.image ? '#2dd4bf' : '#374151',
          width: '10px',
          height: '10px',
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{
          top: '68%',
          background: pkg.text ? '#a78bfa' : '#374151',
          width: '10px',
          height: '10px',
        }}
      />
    </>
  );

  return (
    <>
      <BaseNode
        nodeId={id}
        nodeType="packageNode"
        icon={Box}
        title="Asset Package"
        hasInput={false}
        hasOutput={true}
        customHandles={customHandles}
        error={data.error}
        statusMessage={data.statusMessage}
        retryState={data.retryState}
      >
        <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
          <div className="flex gap-3">
            {pkg.image ? (
              <div className="relative h-14 w-14 shrink-0 rounded-lg border border-gray-700 bg-gray-950 overflow-hidden flex items-center justify-center">
                <img src={pkg.image} alt="Package Output" className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="h-14 w-14 shrink-0 rounded-lg border border-dashed border-gray-700 bg-gray-900 flex flex-col items-center justify-center text-gray-500">
                <ImageIcon size={16} />
                <span className="text-[8px] mt-1 uppercase font-bold tracking-wider">No Image</span>
              </div>
            )}

            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <span className="font-semibold text-gray-200">
                {data.customTitle || 'Asset Package'}
              </span>
              <span className="text-[10px] text-gray-400 mt-1 truncate">
                {pkg.text ? pkg.text.slice(0, 48) : 'No description text connected'}
              </span>
            </div>
          </div>

          {pkg.text && (
            <button
              onClick={() => setIsViewerOpen(true)}
              className="mt-1 w-full flex items-center justify-center gap-1.5 rounded-lg border border-gray-700 bg-[#161821] px-2 py-1.5 font-semibold text-gray-200 transition-all hover:bg-gray-800 hover:text-white"
              type="button"
            >
              <Eye size={12} className="text-purple-400" />
              View Description
            </button>
          )}

          <div className="mt-1 leading-5 text-gray-500 text-[10px]">
            Combines an image and descriptions into a single output branch. Connected generators automatically unpack both inputs.
          </div>
        </div>
      </BaseNode>

      {isViewerOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm pointer-events-auto">
          <div className="flex h-max max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-gray-700 bg-[#15171e] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-800 bg-[#1a1d26] px-4 py-3 text-sm font-bold text-gray-100">
              <div className="flex items-center gap-2">
                <FileText size={15} className="text-purple-400" />
                <span>Concatenated Package Description</span>
              </div>
              <button
                onClick={() => setIsViewerOpen(false)}
                className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
                type="button"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-4 text-xs leading-5 text-gray-300 bg-[#0c0e14] whitespace-pre-wrap font-sans selection:bg-purple-500/30 selection:text-white">
              {pkg.text}
            </div>

            {/* Footer */}
            <div className="flex justify-end border-t border-gray-800 bg-[#1a1d26] px-4 py-2.5">
              <button
                onClick={() => setIsViewerOpen(false)}
                className="rounded-lg border border-gray-700 bg-[#222530] px-3.5 py-1.5 text-xs font-bold text-gray-200 transition-colors hover:text-white hover:bg-gray-800"
                type="button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export const PackageNode = memo(PackageNodeComponent);
