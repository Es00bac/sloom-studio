import { cloneBitmap } from '../LayerBitmap';
import {
  applyToneBrushToBitmap,
  describeRetouchBrushToolPlan,
  resolveRetouchStrokeDensityStep,
  type ToneBrushMode,
} from '../ImageRetouch';
import { canEditImageLayerPixels } from '../../../lib/imageLayerLocks';
import { createRetouchOutputLayer, insertRetouchOutputLayer } from './retouchOutputLayer';
import { resolveRetouchTargetLayer } from './retouchTargetLayer';
import { brushStraightLineStart, recordBrushStrokeAnchor } from './brushLineAnchor';
import type { Point, ToolEnv, ToolHandler } from './types';

interface ToneBrushStroke {
  layerId: string;
  sourceLayerId: string;
  targetLayer: NonNullable<ToolEnv['activeLayer']>;
  bitmapBefore: OffscreenCanvas | null;
  layersBefore: NonNullable<ToolEnv['doc']>['layers'];
  outputMode: 'activeLayer' | 'newLayer';
  lastPoint: Point;
}

/** Document-space bounding box of a hard-edged circular dab (or a straight segment of them, since
 * every point on the segment falls inside the two endpoints' bounding box) — same margin
 * convention as brushTool's dabsDocRect, for the same seam (dirty-rect compositing). Dodge/burn
 * writes strictly within `(size-1)/2` of the target point (see applyToneBrushToImageData), so the
 * `+2` margin is a safe superset. */
function toneStrokeDocRect(from: Point, to: Point, size: number): { x: number; y: number; width: number; height: number } {
  const r = size / 2 + 2;
  const minX = Math.min(from.x, to.x) - r;
  const minY = Math.min(from.y, to.y) - r;
  const maxX = Math.max(from.x, to.x) + r;
  const maxY = Math.max(from.y, to.y) + r;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const toneBrushCapabilityDescriptors = {
  dodge: describeRetouchBrushToolPlan({
    tool: 'dodge',
    size: 25,
    strength: 0.5,
    toneRange: 'midtones',
    protectTones: true,
  }),
  burn: describeRetouchBrushToolPlan({
    tool: 'burn',
    size: 25,
    strength: 0.5,
    toneRange: 'midtones',
    protectTones: true,
  }),
} as const;

function makeToneBrushTool(mode: ToneBrushMode): ToolHandler {
  let stroke: ToneBrushStroke | null = null;
  const toolKey = mode === 'dodge' ? 'dodgeBrush' : 'burnBrush';

  const toneAt = (env: ToolEnv, targetPoint: Point) => {
    if (!stroke) return;
    const layer = stroke.targetLayer;
    if (!layer?.bitmap) return;
    applyToneBrushToBitmap(layer.bitmap, {
      mode,
      targetPoint: {
        x: targetPoint.x - layer.x,
        y: targetPoint.y - layer.y,
      },
      size: env.brushSettings.size,
      strength: env.brushSettings.opacity,
      toneRange: env.retouchToolSettings?.toneRange ?? 'midtones',
      protectTones: env.retouchToolSettings?.protectTones ?? true,
    });
  };

  const toneBetween = (env: ToolEnv, from: Point, to: Point) => {
    const airbrush = env.retouchToolSettings?.airbrush ?? false;
    const rate = env.retouchToolSettings?.rate ?? 0.5;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const step = resolveRetouchStrokeDensityStep({
      size: env.brushSettings.size,
      airbrush,
      rate,
    });
    const steps = Math.max(1, Math.ceil(distance / step));
    for (let index = 1; index <= steps; index += 1) {
      const amount = index / steps;
      toneAt(env, {
        x: from.x + (to.x - from.x) * amount,
        y: from.y + (to.y - from.y) * amount,
      });
    }
  };

  return {
    onPointerDown(env, point, mods) {
      const layer = resolveRetouchTargetLayer(env, point);
      if (!canEditImageLayerPixels(layer) || !layer?.bitmap) return;
      // Shift straight-line: tone a straight segment from the previous stroke's end to this point.
      const lineStart = brushStraightLineStart(toolKey, env.doc.id, mods) ?? point;
      const outputMode = env.retouchToolSettings?.outputMode ?? 'activeLayer';
      const layersBefore = [...env.doc.layers];
      const targetLayer = outputMode === 'newLayer'
        ? createRetouchOutputLayer(layer, mode)
        : layer;
      if (outputMode === 'newLayer') {
        env.store.setLayers(
          env.doc.id,
          insertRetouchOutputLayer(layersBefore, layer.id, targetLayer),
          targetLayer.id,
        );
      }
      stroke = {
        layerId: targetLayer.id,
        sourceLayerId: layer.id,
        targetLayer,
        bitmapBefore: outputMode === 'newLayer' ? null : cloneBitmap(layer.bitmap),
        layersBefore,
        outputMode,
        lastPoint: lineStart,
      };
      if (lineStart !== point) {
        toneBetween(env, lineStart, point);
      } else {
        toneAt(env, point);
      }
      // Report the doc-space region this dab/segment touched so the renderer recomposites only
      // that rect (dirty-rect compositing) instead of the whole document — same seam as brush/mask
      // painting.
      env.markDirty?.(toneStrokeDocRect(lineStart, point, env.brushSettings.size));
      stroke.lastPoint = point;
      env.requestRender({ invalidateBitmapCache: true });
    },

    onPointerMove(env, point) {
      if (!stroke) return;
      toneBetween(env, stroke.lastPoint, point);
      env.markDirty?.(toneStrokeDocRect(stroke.lastPoint, point, env.brushSettings.size));
      stroke.lastPoint = point;
      env.requestRender({ invalidateBitmapCache: true });
    },

    onPointerUp(env) {
      if (!stroke) return;
      recordBrushStrokeAnchor(toolKey, env.doc.id, stroke.lastPoint);
      const layer = stroke.targetLayer;
      if (layer?.bitmap && stroke.outputMode === 'newLayer') {
        const afterLayers = insertRetouchOutputLayer(stroke.layersBefore, stroke.sourceLayerId, layer);
        env.store.setLayers(env.doc.id, afterLayers, layer.id);
        env.pushOperation({
          kind: 'layerOp',
          docId: env.doc.id,
          before: stroke.layersBefore,
          after: afterLayers,
        });
        env.store.bumpLayerBitmapVersion(env.doc.id, layer.id);
        env.store.markDocumentDirty(env.doc.id);
        env.requestRender({ invalidateBitmapCache: true });
      } else if (layer?.bitmap && stroke.bitmapBefore) {
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
      const layer = stroke.targetLayer;
      if (stroke.outputMode === 'newLayer') {
        env.store.setLayers(env.doc.id, stroke.layersBefore, stroke.sourceLayerId);
        env.requestRender({ invalidateBitmapCache: true });
      } else if (layer?.bitmap && stroke.bitmapBefore) {
        layer.bitmap.getContext('2d')?.drawImage(stroke.bitmapBefore, 0, 0);
        env.requestRender({ invalidateBitmapCache: true });
      }
      stroke = null;
    },
  };
}

export const dodgeBrushTool = makeToneBrushTool('dodge');
export const burnBrushTool = makeToneBrushTool('burn');
