import { cloneBitmap } from '../LayerBitmap';
import {
  describeRetouchBrushToolPlan,
  describeRetouchToolReadiness,
} from '../ImageRetouch';
import { canEditImageLayerPixels } from '../../../lib/imageLayerLocks';
import { DEFAULT_RETOUCH_TOOL_SETTINGS } from '../../../types/imageEditor';
import { resolveRetouchTargetLayer } from './retouchTargetLayer';
import { BrushStrokeController } from '../../../lib/brushEngine';
import { createRetouchStrokeController } from './retouchBrushEngine';
import { brushStraightLineStart, recordBrushStrokeAnchor } from './brushLineAnchor';
import type { Point, ToolHandler } from './types';

interface SharpenBrushStroke {
  layerId: string;
  bitmapBefore: OffscreenCanvas;
  controller: BrushStrokeController;
  lastDocPoint: Point;
}

let stroke: SharpenBrushStroke | null = null;

export const sharpenBrushCapabilityDescriptor = describeRetouchBrushToolPlan({
  tool: 'sharpen',
  size: 25,
  strength: 0.5,
});

export const sharpenBrushReadinessDescriptor = describeRetouchToolReadiness({
  tool: 'sharpen',
  sampleMode: DEFAULT_RETOUCH_TOOL_SETTINGS.sampleMode,
});

export const sharpenBrushFinishingReadinessSignature = sharpenBrushReadinessDescriptor.actionReadiness.signature;

export const sharpenBrushTool: ToolHandler = {
  onPointerDown(env, point, mods) {
    const layer = resolveRetouchTargetLayer(env, point);
    if (!canEditImageLayerPixels(layer) || !layer?.bitmap) return;
    const bitmapBefore = cloneBitmap(layer.bitmap);
    const controller = createRetouchStrokeController(env, layer, bitmapBefore, 'sharpen');
    // Shift straight-line: anchor at the previous stroke's end so this move draws a connecting line.
    const lineStart = brushStraightLineStart('sharpenBrush', env.doc.id, mods);
    if (lineStart) controller.anchor({ x: lineStart.x - layer.x, y: lineStart.y - layer.y });
    controller.moveTo({ x: point.x - layer.x, y: point.y - layer.y });
    const dirty = controller.previewInto(layer.bitmap);
    // Bound the recomposite to the touched region (dirty-rect), like the brush/smudge paths —
    // instead of a full document recomposite every move. Layer-local rect → document space.
    if (dirty) {
      env.markDirty?.({
        x: dirty.x + layer.x,
        y: dirty.y + layer.y,
        width: dirty.width,
        height: dirty.height,
      });
    }
    stroke = { layerId: layer.id, bitmapBefore, controller, lastDocPoint: point };
    env.requestRender({ invalidateBitmapCache: true });
  },

  onPointerMove(env, point) {
    if (!stroke) return;
    const layer = env.doc.layers.find((candidate) => candidate.id === stroke?.layerId);
    if (!layer?.bitmap) return;
    stroke.controller.moveTo({ x: point.x - layer.x, y: point.y - layer.y });
    const dirty = stroke.controller.previewInto(layer.bitmap);
    if (dirty) {
      env.markDirty?.({
        x: dirty.x + layer.x,
        y: dirty.y + layer.y,
        width: dirty.width,
        height: dirty.height,
      });
    }
    stroke.lastDocPoint = point;
    env.requestRender({ invalidateBitmapCache: true });
  },

  onPointerUp(env) {
    if (!stroke) return;
    recordBrushStrokeAnchor('sharpenBrush', env.doc.id, stroke.lastDocPoint);
    const layer = env.doc.layers.find((candidate) => candidate.id === stroke?.layerId);
    if (layer?.bitmap) {
      stroke.controller.commit(layer.bitmap);
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
    stroke.controller.cancel();
    const layer = env.doc.layers.find((candidate) => candidate.id === stroke?.layerId);
    if (layer?.bitmap) {
      layer.bitmap.getContext('2d')?.drawImage(stroke.bitmapBefore, 0, 0);
      env.requestRender({ invalidateBitmapCache: true });
    }
    stroke = null;
  },
};
