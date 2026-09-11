import { cloneBitmap } from '../LayerBitmap';
import {
  applySpotHealToBitmap,
  buildRetouchSampleSource,
  describeRetouchBrushRouteSupport,
  describeRetouchParityChecks,
  describeRetouchPreviewIds,
  describeRetouchToolReadiness,
  describeSpotHealToolWorkflow,
  type RetouchSampleSource,
} from '../ImageRetouch';
import { canEditImageLayerPixels } from '../../../lib/imageLayerLocks';
import { DEFAULT_RETOUCH_TOOL_SETTINGS } from '../../../types/imageEditor';
import { resolveRetouchTargetLayer } from './retouchTargetLayer';
import { brushStraightLineStart, recordBrushStrokeAnchor } from './brushLineAnchor';
import type { Point, ToolEnv, ToolHandler } from './types';

interface SpotHealStroke {
  layerId: string;
  bitmapBefore: OffscreenCanvas;
  sampleSource: RetouchSampleSource;
  lastPoint: Point;
  /** Document-space healing-brush source (Alt set), or null for in-place spot-heal sampling. */
  healSource: Point | null;
  strokeStart: Point;
}

// Healing-brush mode: Alt+click sets an explicit source point (Photoshop's healing brush). When no
// source is set the tool behaves as the spot-healing brush, sampling the target's own neighbourhood.
let healSourcePoint: Point | null = null;
let healAlignedOffset: Point | null = null;
let stroke: SpotHealStroke | null = null;

/** Document-space bounding box of a hard-edged circular dab (or a straight segment of them, since
 * every point on the segment falls inside the two endpoints' bounding box) — same margin
 * convention as brushTool's dabsDocRect, for the same seam (dirty-rect compositing). Only the
 * TARGET (write) side needs reporting — the source point is read-only. Spot-heal writes strictly
 * within `(size-1)/2` of the target point (see applySpotHealToImageData), so the `+2` margin is a
 * safe superset. */
function spotHealStrokeDocRect(from: Point, to: Point, size: number): { x: number; y: number; width: number; height: number } {
  const r = size / 2 + 2;
  const minX = Math.min(from.x, to.x) - r;
  const minY = Math.min(from.y, to.y) - r;
  const maxX = Math.max(from.x, to.x) + r;
  const maxY = Math.max(from.y, to.y) + r;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const spotHealWorkflowCapabilityDescriptor = describeSpotHealToolWorkflow({
  sampleMode: DEFAULT_RETOUCH_TOOL_SETTINGS.sampleMode,
  size: 25,
  opacity: 1,
});

export const spotHealReadinessDescriptor = describeRetouchToolReadiness({
  tool: 'spotHeal',
  sampleMode: DEFAULT_RETOUCH_TOOL_SETTINGS.sampleMode,
});

export const spotHealRepairOutputParityCheckDescriptor = describeRetouchParityChecks({
  healSampleMode: DEFAULT_RETOUCH_TOOL_SETTINGS.sampleMode,
}).repairOutput;

export const spotHealPreviewIdDescriptor = describeRetouchPreviewIds({
  healSampleMode: DEFAULT_RETOUCH_TOOL_SETTINGS.sampleMode,
}).spotHeal;

export const spotHealRouteSupportDescriptor = describeRetouchBrushRouteSupport({
  tool: 'spotHeal',
  sampleMode: DEFAULT_RETOUCH_TOOL_SETTINGS.sampleMode,
});

export const spotHealTool: ToolHandler = {
  onPointerDown(env, point, mods) {
    // Alt sets the healing-brush source point (Photoshop convention); it persists until re-set.
    if (mods.alt) {
      healSourcePoint = point;
      healAlignedOffset = null;
      return;
    }

    const layer = resolveRetouchTargetLayer(env, point);
    if (!canEditImageLayerPixels(layer) || !layer?.bitmap) return;
    const bitmapBefore = cloneBitmap(layer.bitmap);
    const settings = env.retouchToolSettings ?? DEFAULT_RETOUCH_TOOL_SETTINGS;
    // Shift straight-line: heal a straight segment from the previous stroke's end to this point.
    const lineStart = brushStraightLineStart('spotHeal', env.doc.id, mods) ?? point;
    if (healSourcePoint && settings.aligned && !healAlignedOffset) {
      healAlignedOffset = {
        x: healSourcePoint.x - lineStart.x,
        y: healSourcePoint.y - lineStart.y,
      };
    }
    stroke = {
      layerId: layer.id,
      bitmapBefore,
      sampleSource: buildRetouchSampleSource({
        doc: env.doc,
        layer,
        layerSnapshot: bitmapBefore,
        sampleMode: settings.sampleMode,
      }),
      lastPoint: lineStart,
      healSource: healSourcePoint ? { x: healSourcePoint.x, y: healSourcePoint.y } : null,
      strokeStart: lineStart,
    };
    if (lineStart !== point) {
      healBetween(env, lineStart, point);
    } else {
      healAt(env, point);
    }
    // Report the doc-space region this dab/segment touched so the renderer recomposites only
    // that rect (dirty-rect compositing) instead of the whole document — same seam as brush/mask
    // painting.
    env.markDirty?.(spotHealStrokeDocRect(lineStart, point, env.brushSettings.size));
    stroke.lastPoint = point;
    env.requestRender({ invalidateBitmapCache: true });
  },

  onPointerMove(env, point) {
    if (!stroke) return;
    healBetween(env, stroke.lastPoint, point);
    env.markDirty?.(spotHealStrokeDocRect(stroke.lastPoint, point, env.brushSettings.size));
    stroke.lastPoint = point;
    env.requestRender({ invalidateBitmapCache: true });
  },

  onPointerUp(env) {
    if (!stroke) return;
    recordBrushStrokeAnchor('spotHeal', env.doc.id, stroke.lastPoint);
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

function healBetween(env: ToolEnv, from: Point, to: Point): void {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(1, env.brushSettings.size / 3);
  const steps = Math.max(1, Math.ceil(distance / step));
  for (let index = 1; index <= steps; index += 1) {
    const amount = index / steps;
    healAt(env, {
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
    });
  }
}

function healAt(env: ToolEnv, targetPoint: Point): void {
  if (!stroke) return;
  const layer = env.doc.layers.find((candidate) => candidate.id === stroke?.layerId);
  if (!layer?.bitmap) return;
  const settings = env.retouchToolSettings ?? DEFAULT_RETOUCH_TOOL_SETTINGS;
  // Healing-brush mode (Alt source set): map the source by the stroke offset like the clone stamp.
  // Spot-heal mode (no source): heal in place from the target's own neighbourhood (source = target).
  const sourceDocPoint = stroke.healSource
    ? settings.aligned && healAlignedOffset
      ? { x: targetPoint.x + healAlignedOffset.x, y: targetPoint.y + healAlignedOffset.y }
      : {
          x: stroke.healSource.x + (targetPoint.x - stroke.strokeStart.x),
          y: stroke.healSource.y + (targetPoint.y - stroke.strokeStart.y),
        }
    : targetPoint;
  const sourcePoint = stroke.sampleSource.coordinateSpace === 'document'
    ? sourceDocPoint
    : {
        x: sourceDocPoint.x - layer.x,
        y: sourceDocPoint.y - layer.y,
      };
  applySpotHealToBitmap(layer.bitmap, {
    targetPoint: {
      x: targetPoint.x - layer.x,
      y: targetPoint.y - layer.y,
    },
    sourcePoint,
    size: env.brushSettings.size,
    opacity: env.brushSettings.opacity,
    sourceBitmap: stroke.sampleSource.bitmap,
  });
}
