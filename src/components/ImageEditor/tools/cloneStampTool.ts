import { cloneBitmap } from '../LayerBitmap';
import {
  applyCloneStampToBitmap,
  buildRetouchSampleSource,
  describeCloneStampToolWorkflow,
  describeRetouchBrushRouteSupport,
  describeRetouchParityChecks,
  describeRetouchPreviewIds,
  describeRetouchToolReadiness,
  resolveCloneStampSourcePoint,
  type RetouchSampleSource,
} from '../ImageRetouch';
import { canEditImageLayerPixels } from '../../../lib/imageLayerLocks';
import { DEFAULT_RETOUCH_TOOL_SETTINGS } from '../../../types/imageEditor';
import { resolveRetouchTargetLayer } from './retouchTargetLayer';
import { brushStraightLineStart, recordBrushStrokeAnchor } from './brushLineAnchor';
import type { Point, ToolEnv, ToolHandler } from './types';

interface CloneStampStroke {
  layerId: string;
  bitmapBefore: OffscreenCanvas;
  samplePoint: Point;
  strokeStart: Point;
  sampleSource: RetouchSampleSource;
  lastPoint: Point;
}

let samplePoint: Point | null = null;
let alignedOffset: Point | null = null;
let stroke: CloneStampStroke | null = null;

/** Document-space bounding box of a hard-edged circular dab (or a straight segment of them, since
 * every point on the segment falls inside the two endpoints' bounding box) — same margin
 * convention as brushTool's dabsDocRect, for the same seam (dirty-rect compositing). Only the
 * TARGET (write) side needs reporting — the source point is read-only. Clone stamp writes strictly
 * within `(size-1)/2` of the target point (see applyCloneStampToImageData), so the `+2` margin is a
 * safe superset. */
function cloneStampStrokeDocRect(from: Point, to: Point, size: number): { x: number; y: number; width: number; height: number } {
  const r = size / 2 + 2;
  const minX = Math.min(from.x, to.x) - r;
  const minY = Math.min(from.y, to.y) - r;
  const maxX = Math.max(from.x, to.x) + r;
  const maxY = Math.max(from.y, to.y) + r;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const cloneStampWorkflowCapabilityDescriptor = describeCloneStampToolWorkflow({
  sampleMode: DEFAULT_RETOUCH_TOOL_SETTINGS.sampleMode,
  aligned: DEFAULT_RETOUCH_TOOL_SETTINGS.aligned,
  hasSamplePoint: false,
  size: 25,
  opacity: 1,
});

export const cloneStampReadinessDescriptor = describeRetouchToolReadiness({
  tool: 'cloneStamp',
  sampleMode: DEFAULT_RETOUCH_TOOL_SETTINGS.sampleMode,
  hasSamplePoint: false,
  aligned: DEFAULT_RETOUCH_TOOL_SETTINGS.aligned,
});

export const cloneStampParityCheckDescriptor = describeRetouchParityChecks({
  cloneSampleMode: DEFAULT_RETOUCH_TOOL_SETTINGS.sampleMode,
  cloneAligned: DEFAULT_RETOUCH_TOOL_SETTINGS.aligned,
  cloneHasSamplePoint: false,
}).cloneSource;

export const cloneStampPreviewIdDescriptor = describeRetouchPreviewIds({
  cloneSampleMode: DEFAULT_RETOUCH_TOOL_SETTINGS.sampleMode,
  cloneAligned: DEFAULT_RETOUCH_TOOL_SETTINGS.aligned,
  cloneHasSamplePoint: false,
}).cloneStamp;

export const cloneStampRouteSupportDescriptor = describeRetouchBrushRouteSupport({
  tool: 'cloneStamp',
  sampleMode: DEFAULT_RETOUCH_TOOL_SETTINGS.sampleMode,
  hasSamplePoint: false,
});

export const cloneStampTool: ToolHandler = {
  onPointerDown(env, point, mods) {
    if (mods.alt) {
      samplePoint = point;
      alignedOffset = null;
      return;
    }

    const layer = resolveRetouchTargetLayer(env, point);
    if (!canEditImageLayerPixels(layer) || !layer?.bitmap || !samplePoint) return;
    const bitmapBefore = cloneBitmap(layer.bitmap);
    const settings = env.retouchToolSettings ?? DEFAULT_RETOUCH_TOOL_SETTINGS;
    // Shift straight-line: anchor the stroke at the previous stamp's end so this press lays a
    // straight cloned line to the new point, carrying the source offset along the way.
    const lineStart = brushStraightLineStart('cloneStamp', env.doc.id, mods) ?? point;
    if (settings.aligned && !alignedOffset) {
      alignedOffset = {
        x: samplePoint.x - lineStart.x,
        y: samplePoint.y - lineStart.y,
      };
    }
    stroke = {
      layerId: layer.id,
      bitmapBefore,
      samplePoint,
      strokeStart: lineStart,
      sampleSource: buildRetouchSampleSource({
        doc: env.doc,
        layer,
        layerSnapshot: bitmapBefore,
        sampleMode: settings.sampleMode,
      }),
      lastPoint: lineStart,
    };
    if (lineStart !== point) {
      stampBetween(env, lineStart, point);
    } else {
      stampAt(env, point);
    }
    // Report the doc-space region this dab/segment touched so the renderer recomposites only
    // that rect (dirty-rect compositing) instead of the whole document — same seam as brush/mask
    // painting.
    env.markDirty?.(cloneStampStrokeDocRect(lineStart, point, env.brushSettings.size));
    stroke.lastPoint = point;
    env.requestRender({ invalidateBitmapCache: true });
  },

  onPointerMove(env, point) {
    if (!stroke) return;
    stampBetween(env, stroke.lastPoint, point);
    env.markDirty?.(cloneStampStrokeDocRect(stroke.lastPoint, point, env.brushSettings.size));
    stroke.lastPoint = point;
    env.requestRender({ invalidateBitmapCache: true });
  },

  onPointerUp(env) {
    if (!stroke) return;
    recordBrushStrokeAnchor('cloneStamp', env.doc.id, stroke.lastPoint);
    const layer = env.doc.layers.find((candidate) => candidate.id === stroke?.layerId);
    if (layer?.bitmap) {
      env.pushOperation({
        kind: 'paint',
        docId: env.doc.id,
        layerId: layer.id,
        before: stroke.bitmapBefore,
        after: cloneBitmap(layer.bitmap),
      });
      env.store.bumpLayerBitmapVersion(env.doc.id, layer.id);
      env.store.markDocumentDirty(env.doc.id);
      env.requestRender({ invalidateBitmapCache: true });
    }
    stroke = null;
  },

  onCancel(env) {
    if (!stroke) return;
    const layer = env.doc.layers.find((candidate) => candidate.id === stroke?.layerId);
    if (layer?.bitmap) {
      layer.bitmap.getContext('2d')?.drawImage(stroke.bitmapBefore, 0, 0);
      env.requestRender({ invalidateBitmapCache: true });
    }
    stroke = null;
  },
};

export function hasCloneStampSample(): boolean {
  return Boolean(samplePoint);
}

function stampBetween(env: ToolEnv, from: Point, to: Point): void {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(1, env.brushSettings.size / 3);
  const steps = Math.max(1, Math.ceil(distance / step));
  for (let index = 1; index <= steps; index += 1) {
    const amount = index / steps;
    stampAt(env, {
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
    });
  }
}

function stampAt(env: ToolEnv, targetPoint: Point): void {
  if (!stroke) return;
  const layer = env.doc.layers.find((candidate) => candidate.id === stroke?.layerId);
  if (!layer?.bitmap) return;
  const settings = env.retouchToolSettings ?? DEFAULT_RETOUCH_TOOL_SETTINGS;
  const sourceDocPoint = settings.aligned && alignedOffset
    ? {
        x: targetPoint.x + alignedOffset.x,
        y: targetPoint.y + alignedOffset.y,
      }
    : resolveCloneStampSourcePoint({
        samplePoint: stroke.samplePoint,
        strokeStart: stroke.strokeStart,
        targetPoint,
      });
  const sourcePoint = stroke.sampleSource.coordinateSpace === 'document'
    ? sourceDocPoint
    : {
        x: sourceDocPoint.x - layer.x,
        y: sourceDocPoint.y - layer.y,
      };
  applyCloneStampToBitmap(layer.bitmap, {
    sourcePoint,
    targetPoint: {
      x: targetPoint.x - layer.x,
      y: targetPoint.y - layer.y,
    },
    size: env.brushSettings.size,
    opacity: env.brushSettings.opacity,
    sourceBitmap: stroke.sampleSource.bitmap,
  });
}
