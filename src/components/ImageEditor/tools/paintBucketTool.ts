import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
  type BrushSettings,
  type ImageColorChannel,
  type ImageLayer,
  type SelectionToolSettings,
} from '../../../types/imageEditor';
import { canEditImageLayerPixels } from '../../../lib/imageLayerLocks';
import { cloneBitmap, createBitmap, getBitmapImageData } from '../LayerBitmap';
import {
  describePaintBucketActionReadiness,
  fillContiguousColorRegionInBitmap,
  type PaintBucketActionReadinessDescriptor,
  type PaintBucketActionTarget,
  type PaintBucketFillOperationDescriptor,
} from '../ImagePaintBucket';
import type { ToolEnv, ToolHandler } from './types';

export interface PaintBucketToolWorkflowDescriptorOptions {
  brushSettings?: Partial<Pick<BrushSettings, 'color' | 'opacity'>>;
  selectionSettings?: Partial<Pick<
    SelectionToolSettings,
    | 'magicWandTolerance'
    | 'sampleAllLayers'
    | 'contiguous'
    | 'antiAlias'
    | 'paintBucketBlendMode'
    | 'paintBucketPreserveTransparency'
  >>;
  activeColorChannel?: ImageColorChannel;
  target?: PaintBucketActionTarget;
  requestedAntiAlias?: boolean;
  requestedGapClose?: number | boolean;
  hasPixelSource?: boolean;
  hasWritableLayer?: boolean;
}

export interface PaintBucketToolWorkflowDescriptor {
  descriptorId: 'paint-bucket-tool-workflow:v1';
  tool: 'paintBucket';
  tolerance: PaintBucketFillOperationDescriptor['tolerance'];
  matching: PaintBucketFillOperationDescriptor['matching'];
  sampling: PaintBucketFillOperationDescriptor['sampling'];
  fill: PaintBucketFillOperationDescriptor['fill'];
  target: PaintBucketFillOperationDescriptor['target'];
  warnings: PaintBucketFillOperationDescriptor['warnings'];
  edgeControls: {
    antiAlias: {
      requested: boolean;
      supported: true;
      maxPixels: 1;
    };
    gapClose: {
      requestedPixels: number;
      supported: false;
      maxPixels: 0;
    };
  };
  sourceBin: {
    exportSignature: string;
    caveats: string[];
  };
  readinessChecks: PaintBucketActionReadinessDescriptor['checks'];
  routing: PaintBucketActionReadinessDescriptor['routing'];
  stableSignatures: {
    workflow: string;
    checks: string;
    routing: string;
  };
  previewSignature: string;
}

export function describePaintBucketToolWorkflow(
  options: PaintBucketToolWorkflowDescriptorOptions = {},
): PaintBucketToolWorkflowDescriptor {
  const brushSettings = {
    ...DEFAULT_BRUSH_SETTINGS,
    ...options.brushSettings,
  };
  const selectionSettings = {
    ...DEFAULT_SELECTION_TOOL_SETTINGS,
    ...options.selectionSettings,
  };
  const actionReadiness = describePaintBucketActionReadiness({
    seed: { x: 0, y: 0 },
    color: brushSettings.color,
    opacity: brushSettings.opacity,
    blendMode: selectionSettings.paintBucketBlendMode,
    preserveTransparency: selectionSettings.paintBucketPreserveTransparency,
    tolerance: selectionSettings.magicWandTolerance,
    contiguous: selectionSettings.contiguous,
    sampleAllLayers: selectionSettings.sampleAllLayers,
    targetChannel: options.activeColorChannel ?? 'rgb',
    target: options.target,
    requestedAntiAlias: options.requestedAntiAlias ?? selectionSettings.antiAlias,
    requestedGapClose: options.requestedGapClose,
    hasPixelSource: options.hasPixelSource,
    hasWritableLayer: options.hasWritableLayer,
  });
  const fillDescriptor = actionReadiness.operation;
  const descriptor = {
    descriptorId: 'paint-bucket-tool-workflow:v1' as const,
    tool: 'paintBucket' as const,
    tolerance: fillDescriptor.tolerance,
    matching: fillDescriptor.matching,
    sampling: fillDescriptor.sampling,
    fill: fillDescriptor.fill,
    target: fillDescriptor.target,
    warnings: fillDescriptor.warnings,
    edgeControls: {
      antiAlias: {
        requested: (options.requestedAntiAlias ?? selectionSettings.antiAlias) === true,
        supported: true as const,
        maxPixels: 1 as const,
      },
      gapClose: {
        requestedPixels: fillDescriptor.matching.gapClosePixels,
        supported: false as const,
        maxPixels: 0 as const,
      },
    },
  };
  const previewSignature = buildPaintBucketToolWorkflowPreviewSignature(descriptor);

  return {
    ...descriptor,
    sourceBin: {
      exportSignature: [
        'paint-bucket-tool-export:v1',
        previewSignature,
        'flatten:active-layer-rgba',
      ].join('|'),
      caveats: [
        'Paint Bucket Source Bin reuse captures flattened fill settings and signatures, not retained channel- or mask-native bucket objects.',
      ],
    },
    readinessChecks: actionReadiness.checks,
    routing: actionReadiness.routing,
    stableSignatures: {
      workflow: previewSignature,
      checks: actionReadiness.stableSignatures.checks,
      routing: actionReadiness.stableSignatures.routing,
    },
    previewSignature,
  };
}

export const paintBucketTool: ToolHandler = {
  onPointerDown(env, point) {
    const layer = ensureLayer(env);
    if (!canEditImageLayerPixels(layer)) return;
    const bitmap = ensureBitmap(env, layer);
    const localSeed = {
      x: point.x - layer.x,
      y: point.y - layer.y,
    };
    const before = cloneBitmap(bitmap);
    fillContiguousColorRegionInBitmap(bitmap, {
      seed: localSeed,
      color: env.brushSettings.color,
      opacity: env.brushSettings.opacity,
      blendMode: env.selectionToolSettings.paintBucketBlendMode,
      preserveTransparency: env.selectionToolSettings.paintBucketPreserveTransparency,
      tolerance: env.selectionToolSettings.magicWandTolerance,
      contiguous: env.selectionToolSettings.contiguous,
      antiAlias: env.selectionToolSettings.antiAlias,
      matchSource: buildMatchSource(env, layer, bitmap),
    });
    env.pushOperation({
      kind: 'paint',
      docId: env.doc.id,
      layerId: layer.id,
      before,
      after: cloneBitmap(bitmap),
    });
    env.store.bumpLayerBitmapVersion(env.doc.id, layer.id);
    env.store.markDocumentDirty(env.doc.id);
    env.requestRender();
  },
};

function ensureLayer(env: ToolEnv): ImageLayer | null {
  return env.activeLayer;
}

function ensureBitmap(env: ToolEnv, layer: ImageLayer): OffscreenCanvas {
  if (layer.bitmap) return layer.bitmap;
  const bitmap = createBitmap(env.doc.width, env.doc.height);
  env.store.updateLayer(env.doc.id, layer.id, { bitmap });
  return bitmap;
}

function buildMatchSource(env: ToolEnv, layer: ImageLayer, bitmap: OffscreenCanvas): ImageData {
  if (!env.selectionToolSettings.sampleAllLayers) {
    return getBitmapImageData(bitmap);
  }

  const target = createBitmap(bitmap.width, bitmap.height);
  const ctx = target.getContext('2d');
  if (!ctx) {
    return new ImageData(bitmap.width, bitmap.height);
  }
  for (const candidate of env.doc.layers) {
    if (!candidate.visible || !candidate.bitmap) continue;
    ctx.save();
    ctx.globalAlpha = clamp01(candidate.opacity);
    ctx.globalCompositeOperation = candidate.blendMode as GlobalCompositeOperation;
    ctx.drawImage(candidate.bitmap, candidate.x - layer.x, candidate.y - layer.y);
    ctx.restore();
  }
  return getBitmapImageData(target);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function buildPaintBucketToolWorkflowPreviewSignature(
  descriptor: Pick<
    PaintBucketToolWorkflowDescriptor,
    'tolerance' | 'sampling' | 'matching' | 'fill' | 'target' | 'warnings'
  >,
): string {
  return `paint-bucket-tool-workflow:v1:${JSON.stringify({
    tolerance: descriptor.tolerance.value,
    sampling: descriptor.sampling.source,
    matching: {
      scope: descriptor.matching.scope,
      connectivity: descriptor.matching.connectivity,
      gapClosePixels: descriptor.matching.gapClosePixels,
    },
    fill: descriptor.fill,
    target: {
      requestedChannel: descriptor.target.requestedChannel,
      channelRouting: descriptor.target.channelRouting,
    },
    warnings: descriptor.warnings.map((warning) => warning.code),
  })}`;
}
