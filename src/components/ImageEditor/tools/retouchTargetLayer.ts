import { canEditImageLayerPixels } from '../../../lib/imageLayerLocks';
import type { ImageLayer } from '../../../types/imageEditor';
import type { Point, ToolEnv } from './types';

export function resolveRetouchTargetLayer(env: ToolEnv, point: Point): ImageLayer | null {
  if (isEditableBitmapLayer(env.activeLayer)) return env.activeLayer;

  for (let index = env.doc.layers.length - 1; index >= 0; index -= 1) {
    const layer = env.doc.layers[index];
    if (!isEditableBitmapLayer(layer)) continue;
    if (!layer.visible) continue;
    if (!pointHitsLayerBitmap(layer, point)) continue;
    return layer;
  }

  return null;
}

function isEditableBitmapLayer(layer: ImageLayer | null | undefined): layer is ImageLayer {
  return Boolean(canEditImageLayerPixels(layer) && layer.bitmap);
}

function pointHitsLayerBitmap(layer: ImageLayer, point: Point): boolean {
  if (!layer.bitmap) return false;
  return (
    point.x >= layer.x
    && point.y >= layer.y
    && point.x < layer.x + layer.bitmap.width
    && point.y < layer.y + layer.bitmap.height
  );
}
