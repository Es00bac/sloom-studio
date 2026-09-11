import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Position } from '@xyflow/react';
import { Crop } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { ImagePreviewPane } from './ImagePreviewPane';
import { collectUpstreamImageInputForHandles } from '../../store/flowStore';
import { buildCropPreviewOverlayRect, resolveCropImageNodeSettings, type CropImageNodeSettings } from '../../lib/cropImageNode';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { getCompatibleNodeActions } from '../../lib/nodeActionMenu';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

const numberInputClassName = withFlowNodeInteractionClasses(
  'w-full rounded-md border border-gray-700/60 bg-[#0b1018] px-2 py-1.5 text-[11px] font-semibold text-gray-100 outline-none focus:border-lime-300',
);

function CropImageNodeComponent({ id, data }: AppNodeProps) {
  const settings = resolveCropImageNodeSettings(data);
  const sourceImageUrl = useFlowStore(
    useShallow((state) => collectUpstreamImageInputForHandles(
      id,
      ['image'],
      new Map(state.nodes.map((node) => [node.id, node])),
      state.edges,
    )),
  );
  const cropStyle = {
    left: `${settings.xPercent}%`,
    top: `${settings.yPercent}%`,
    width: `${settings.widthPercent}%`,
    height: `${settings.heightPercent}%`,
  };

  const updateCropField = (
    field: 'cropXPercent' | 'cropYPercent' | 'cropWidthPercent' | 'cropHeightPercent',
    value: string,
  ) => {
    data.onChange?.(field, value === '' ? undefined : Number(value));
  };

  return (
    <BaseNode
      customHandles={(
        <Handle
          id="image"
          type="target"
          position={Position.Left}
          className="!h-6 !w-6 !rounded-full !border-[3px] !border-[#1e2027] !bg-lime-400"
          style={{ left: -12, top: '50%' }}
        />
      )}
      error={data.error}
      hasInput={false}
      hasOutput
      icon={Crop}
      isRunning={data.isRunning}
      nodeId={id}
      nodeType="cropImageNode"
      onRun={data.onRun}
      outputActions={getCompatibleNodeActions('cropImageNode')}
      retryState={data.retryState}
      statusMessage={data.statusMessage}
      title="Crop Image"
    >
      <div className="space-y-3 rounded-lg border border-lime-400/20 bg-lime-400/5 p-3 text-xs">
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
            Source Image
          </div>
          <CropSourcePreview cropStyle={cropStyle} settings={settings} src={sourceImageUrl} />
        </div>

        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
            Crop Box
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { field: 'cropXPercent', label: 'X', value: settings.xPercent },
              { field: 'cropYPercent', label: 'Y', value: settings.yPercent },
              { field: 'cropWidthPercent', label: 'W', value: settings.widthPercent },
              { field: 'cropHeightPercent', label: 'H', value: settings.heightPercent },
            ].map((control) => (
              <label
                className="space-y-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                key={control.field}
              >
                {control.label} %
                <input
                  className={numberInputClassName}
                  max={100}
                  min={control.field === 'cropWidthPercent' || control.field === 'cropHeightPercent' ? 1 : 0}
                  onChange={(event) => updateCropField(
                    control.field as 'cropXPercent' | 'cropYPercent' | 'cropWidthPercent' | 'cropHeightPercent',
                    event.target.value,
                  )}
                  type="number"
                  value={String(control.value)}
                />
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
            Output
          </div>
          <ImagePreviewPane
            alt="Cropped image output"
            fallbackAspectRatio="1:1"
            imageMaxHeightClassName="max-h-28"
            minHeightClassName="min-h-[5.5rem]"
            placeholder={(
              <div className="px-4 text-center text-[10px] text-gray-500">
                Run to output the cropped image.
              </div>
            )}
            src={typeof data.result === 'string' ? data.result : undefined}
          />
        </div>
      </div>
    </BaseNode>
  );
}

export const CropImageNode = memo(CropImageNodeComponent);

export function CropSourcePreview({
  cropStyle,
  settings,
  src,
}: {
  cropStyle: CSSProperties;
  settings?: CropImageNodeSettings;
  src?: string;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [renderedMetrics, setRenderedMetrics] = useState<{
    naturalHeight: number;
    naturalWidth: number;
    renderedHeight: number;
    renderedWidth: number;
    sourceKey: string;
  } | null>(null);

  const measureImage = useCallback(() => {
    const image = imageRef.current;
    if (!image) {
      return;
    }

    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    const renderedWidth = image.clientWidth || image.width;
    const renderedHeight = image.clientHeight || image.height;
    if (naturalWidth <= 0 || naturalHeight <= 0 || renderedWidth <= 0 || renderedHeight <= 0) {
      return;
    }

    const nextMetrics = {
      naturalHeight,
      naturalWidth,
      renderedHeight,
      renderedWidth,
      sourceKey: src ?? '',
    };
    setRenderedMetrics((current) => (
      current
      && current.naturalHeight === nextMetrics.naturalHeight
      && current.naturalWidth === nextMetrics.naturalWidth
      && Math.abs(current.renderedHeight - nextMetrics.renderedHeight) < 0.5
      && Math.abs(current.renderedWidth - nextMetrics.renderedWidth) < 0.5
      && current.sourceKey === nextMetrics.sourceKey
        ? current
        : nextMetrics
    ));
  }, [src]);

  useEffect(() => {
    const image = imageRef.current;
    if (!src || !image) {
      return;
    }

    measureImage();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureImage);
      return () => {
        window.removeEventListener('resize', measureImage);
      };
    }

    const observer = new ResizeObserver(measureImage);
    observer.observe(image);
    return () => {
      observer.disconnect();
    };
  }, [measureImage, src]);

  const effectiveCropStyle = useMemo<CSSProperties>(() => {
    if (!settings || !renderedMetrics || renderedMetrics.sourceKey !== (src ?? '')) {
      return cropStyle;
    }

    const rect = buildCropPreviewOverlayRect(
      renderedMetrics.naturalWidth,
      renderedMetrics.naturalHeight,
      renderedMetrics.renderedWidth,
      renderedMetrics.renderedHeight,
      settings,
    );

    return {
      height: `${rect.height}px`,
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
    };
  }, [cropStyle, renderedMetrics, settings, src]);

  return (
    <div
      className="overflow-hidden rounded-lg border border-gray-700/60 bg-black shadow-inner"
      style={src ? undefined : { aspectRatio: '1' }}
    >
      {src ? (
        <div className="flex w-full items-center justify-center p-2 min-h-[7rem]">
          <div
            className="relative inline-block max-w-full"
            data-crop-preview-frame="rendered-image"
          >
            <img
              alt="Connected crop source"
              className="block h-auto w-auto max-w-full max-h-36 object-contain"
              onLoad={measureImage}
              ref={imageRef}
              src={src}
            />
            <div
              className="pointer-events-none absolute border-2 border-lime-200 bg-lime-300/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]"
              data-crop-preview-overlay-mode={renderedMetrics?.sourceKey === (src ?? '') ? 'pixel' : 'percent'}
              data-crop-preview-overlay="true"
              style={effectiveCropStyle}
            />
          </div>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center p-4 min-h-[7rem]">
          <div className="px-4 text-center text-[10px] text-gray-500">
            Connect one image to crop.
          </div>
        </div>
      )}
    </div>
  );
}
