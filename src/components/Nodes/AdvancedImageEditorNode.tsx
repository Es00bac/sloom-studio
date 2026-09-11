import { memo, useCallback } from 'react';
import { Position } from '@xyflow/react';
import { Image as ImageIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import type { AppNodeProps } from '../../types/flow';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { useEditorStore } from '../../store/editorStore';
import { collectUpstreamImageInputForHandles, useFlowStore } from '../../store/flowStore';
import { createImageDocumentFromSourceItem } from '../ImageEditor/ImageSourceDocument';
import type { SourceBinLibraryItem } from '../../store/sourceBinStore';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../../types/flow';

export function resolveAdvancedImageEditorInputs(nodes: AppNode[], edges: Edge[], nodeId: string) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return {
    sourceImage: collectUpstreamImageInputForHandles(nodeId, ['sourceImage'], nodesById, edges),
    maskImage: collectUpstreamImageInputForHandles(nodeId, ['mask'], nodesById, edges),
    referenceImage: collectUpstreamImageInputForHandles(nodeId, ['reference'], nodesById, edges),
  };
}

function AdvancedImageEditorNode({ data, id }: AppNodeProps) {
  const setWorkspaceView = useEditorStore((s) => s.setWorkspaceView);
  const openDocument = useImageEditorStore((s) => s.openDocument);

  const { sourceImage, maskImage, referenceImage } = useFlowStore(useShallow((state) =>
    resolveAdvancedImageEditorInputs(state.nodes, state.edges, id)
  ));

  const handleOpenInEditor = useCallback(async () => {
    const connected = [
      { key: 'source', label: 'Flow source image', url: sourceImage },
      { key: 'mask', label: 'Flow mask input', url: maskImage },
      { key: 'reference', label: 'Flow reference input', url: referenceImage },
    ].filter((item): item is { key: string; label: string; url: string } => Boolean(item.url));

    if (connected.length === 0) {
      openDocument(createEmptyImageDocument({
        id: `doc-from-node-${id}`,
        title: data.result ? 'Edited Image' : 'New Edit',
        width: 800,
        height: 600,
      }));
    } else {
      const documents = await Promise.all(connected.map(async (item) => {
        const sourceItem: SourceBinLibraryItem = {
          id: `flow-editor-${id}-${item.key}`,
          label: item.label,
          kind: 'image',
          assetUrl: item.url,
          mimeType: item.url.match(/^data:([^;,]+)/)?.[1] ?? 'image/png',
          createdAt: Date.now(),
          originNodeId: id,
        };
        return createImageDocumentFromSourceItem(sourceItem);
      }));
      const [base, ...additional] = documents;
      const layers = [
        ...base.layers,
        ...additional.flatMap((document, documentIndex) => document.layers.map((layer) => ({
          ...layer,
          id: `${layer.id}-${connected[documentIndex + 1].key}`,
          name: connected[documentIndex + 1].label,
        }))),
      ];
      openDocument({
        ...base,
        id: `doc-from-node-${id}`,
        title: data.result ? 'Edited Image' : 'Flow Image Edit',
        layers,
        activeLayerId: layers[0]?.id ?? null,
      });
    }
    setWorkspaceView('image');
  }, [data.result, id, maskImage, openDocument, referenceImage, setWorkspaceView, sourceImage]);

  return (
    <BaseNode
      nodeId={id}
      nodeType="advancedImageEditor"
      icon={ImageIcon}
      title="Image Editor"
      hasInput={false}
      hasOutput={false}
      customHandles={
        <>
          <Handle type="target" position={Position.Left} id="sourceImage" style={{ top: '30%' }} />
          <Handle type="target" position={Position.Left} id="mask" style={{ top: '50%' }} />
          <Handle type="target" position={Position.Left} id="reference" style={{ top: '70%' }} />
          <Handle type="source" position={Position.Right} id="editedImage" style={{ top: '35%' }} />
          <Handle type="source" position={Position.Right} id="maskOutput" style={{ top: '65%' }} />
        </>
      }
    >
      <div className="my-2 grid grid-cols-3 gap-1 rounded bg-[#14151d] p-1 text-[9px] text-cyan-100/50">
        {[
          ['Source', sourceImage],
          ['Mask', maskImage],
          ['Reference', referenceImage],
        ].map(([label, url]) => (
          <div className="min-w-0 text-center" key={label}>
            {url ? (
              <img
                alt={`${label} image input`}
                className="aspect-square w-full rounded object-contain"
                src={url}
              />
            ) : (
              <div className="flex aspect-square items-center justify-center rounded border border-dashed border-cyan-300/10">
                Empty
              </div>
            )}
            <div className="mt-1 truncate">{label}</div>
          </div>
        ))}
      </div>

      <button
        className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-400 hover:bg-[#2a2b33]"
        onClick={handleOpenInEditor}
        type="button"
      >
        Open in Image Editor
      </button>
    </BaseNode>
  );
}

export const AdvancedImageEditorNodeComponent = memo(AdvancedImageEditorNode);
