import { memo } from 'react';
import { Eye } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { collectUpstreamImageInputForHandles, useFlowStore } from '../../store/flowStore';
import { summarizeImagePixels } from '../../lib/imageFeatureExtractor';
import type { AppNodeProps, NodeData } from '../../types/flow';

function ImageFeatureExtractorNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const imageUrl = useFlowStore((state) => collectUpstreamImageInputForHandles(
    id,
    [undefined],
    new Map(state.nodes.map((node) => [node.id, node])),
    state.edges,
  ));
  const features = data.imageFeatures;

  const inspectImage = (image: HTMLImageElement) => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const mimeType = image.currentSrc.match(/^data:([^;,]+)/)?.[1];
    const orientation = width === height ? 'square' : width > height ? 'landscape' : 'portrait';
    const base = { width, height, aspectRatio: height ? Number((width / height).toFixed(4)) : 0, orientation, mimeType } as const;
    let next: NonNullable<NodeData['imageFeatures']> = { ...base };
    try {
      const sampleWidth = Math.max(1, Math.min(64, width));
      const sampleHeight = Math.max(1, Math.min(64, height));
      const canvas = document.createElement('canvas');
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas pixel sampling is unavailable.');
      context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
      next = summarizeImagePixels({
        width,
        height,
        rgba: context.getImageData(0, 0, sampleWidth, sampleHeight).data,
        mimeType,
      });
    } catch {
      next = { ...base, samplingWarning: 'Color sampling is unavailable for this image source.' };
    }
    patchNodeData(id, {
      imageFeatures: next,
      result: JSON.stringify(next),
      resultType: 'json',
    });
  };

  return (
    <BaseNode
      nodeId={id}
      nodeType="imageFeatureExtractorNode"
      icon={Eye}
      title="Image Feature Extractor"
      hasInput={true}
      hasOutput={true}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        {imageUrl ? (
          <img
            alt="Image being analyzed"
            className="max-h-28 w-full rounded-md border border-gray-700 bg-gray-950 object-contain"
            onLoad={(event) => inspectImage(event.currentTarget)}
            src={imageUrl}
          />
        ) : (
          <div className="rounded-md border border-dashed border-gray-700 bg-gray-950 px-2 py-3 text-center text-gray-500">
            Connect an image to analyze it locally.
          </div>
        )}
        {features ? (
          <div className="space-y-1 rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[10px] text-purple-300">
            <div>{features.width} × {features.height} · {features.orientation ?? 'unknown orientation'}</div>
            <div>Average color: {features.averageColor ?? 'unavailable'}</div>
            {features.samplingWarning ? <div className="text-amber-300/80">{features.samplingWarning}</div> : null}
          </div>
        ) : null}
        <div className="mt-1 leading-5 text-gray-400">
          Extracts pixel dimensions, orientation, aspect ratio, and average color locally. It does not infer lighting direction or semantic objects.
        </div>
      </div>
    </BaseNode>
  );
}

export const ImageFeatureExtractorNode = memo(ImageFeatureExtractorNodeComponent);
